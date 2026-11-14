// Package assistant runs the in-app Vaultix assistant: the AI connections an instance
// administrator manages, the model adapters, and the agent loop that acts only through the
// instance's own MCP tools with the signed-in person's session (docs/0123, docs/0126).
package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/vaultix-cloud/api/internal/database/pg"
	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
)

// Kind names how a model is reached. Anthropic, Bedrock, Vertex and Anthropic-style custom
// connections speak the Anthropic Messages format; OpenAI, Hugging Face and OpenAI-style custom
// connections speak chat completions.
type Kind string

const (
	KindAnthropic           Kind = "anthropic"
	KindOpenAI              Kind = "openai"
	KindBedrock             Kind = "bedrock"
	KindVertex              Kind = "vertex"
	KindHuggingFace         Kind = "huggingface"
	KindHuggingFaceEndpoint Kind = "huggingface-endpoint"
	KindCustom              Kind = "custom"
)

var Kinds = []Kind{KindAnthropic, KindOpenAI, KindBedrock, KindVertex, KindHuggingFace, KindHuggingFaceEndpoint, KindCustom}

const (
	maxProviders     = 20
	maxTestMessage   = 300
	defaultTimeout   = 60
	huggingFaceRoute = "https://router.huggingface.co/v1"
)

// Provider is one stored AI connection. Its credential is never part of it.
type Provider struct {
	ID        uuid.UUID
	Kind      Kind
	Name      string
	Model     string
	FastModel string
	DeepModel string
	// BaseURL is the endpoint of a huggingface-endpoint or custom connection. Vendor kinds have
	// fixed addresses; tests point them at local servers through this field.
	BaseURL         string
	APIStyle        string
	AuthType        string
	AuthHeaderName  string
	Headers         []spec.Header
	Region          string
	CloudProject    string
	BillTo          string
	TimeoutSeconds  int
	HasCredential   bool
	Active          bool
	LastTestedAt    *time.Time
	LastTestOutcome string
	LastTestMessage string
	LastTestTools   *bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Connection is how a stored connection is shown: the v1 document without its credential, plus
// what the server knows about it.
type Connection struct {
	ID             uuid.UUID     `json:"id"`
	SchemaVersion  string        `json:"schemaVersion"`
	Name           string        `json:"name"`
	Kind           Kind          `json:"kind"`
	Endpoint       *string       `json:"endpoint,omitempty"`
	APIStyle       *string       `json:"apiStyle,omitempty"`
	Auth           *spec.Auth    `json:"auth,omitempty"`
	Headers        []spec.Header `json:"headers,omitempty"`
	Region         *string       `json:"region,omitempty"`
	CloudProject   *string       `json:"cloudProject,omitempty"`
	BillTo         *string       `json:"billTo,omitempty"`
	Models         spec.Models   `json:"models"`
	TimeoutSeconds int           `json:"timeoutSeconds"`
	Active         bool          `json:"active"`
	HasCredential  bool          `json:"hasCredential"`
	LastTest       *TestRecord   `json:"lastTest"`
	CreatedAt      time.Time     `json:"createdAt"`
	UpdatedAt      time.Time     `json:"updatedAt"`
}

type TestRecord struct {
	Outcome   string    `json:"outcome"`
	Message   string    `json:"message"`
	TestedAt  time.Time `json:"testedAt"`
	ToolCalls *bool     `json:"toolCalls"`
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (p *Provider) View() Connection {
	c := Connection{ID: p.ID, SchemaVersion: spec.ConnectionVersion, Name: p.Name, Kind: p.Kind, Region: optional(p.Region),
		CloudProject: optional(p.CloudProject), BillTo: optional(p.BillTo), TimeoutSeconds: p.TimeoutSeconds, Active: p.Active,
		HasCredential: p.HasCredential, Models: spec.Models{Standard: p.Model, Fast: optional(p.FastModel), Deep: optional(p.DeepModel)},
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}
	if p.Kind == KindHuggingFaceEndpoint || p.Kind == KindCustom {
		c.Endpoint = optional(p.BaseURL)
	}
	if p.Kind == KindCustom {
		c.APIStyle = optional(p.APIStyle)
		c.Auth = &spec.Auth{Type: p.AuthType, HeaderName: optional(p.AuthHeaderName)}
		if len(p.Headers) > 0 {
			c.Headers = p.Headers
		}
	}
	if p.LastTestedAt != nil {
		c.LastTest = &TestRecord{Outcome: p.LastTestOutcome, Message: p.LastTestMessage, TestedAt: *p.LastTestedAt, ToolCalls: p.LastTestTools}
	}
	return c
}

type Credential struct {
	APIKey             string `json:"apiKey,omitempty"`
	AccessKeyID        string `json:"accessKeyId,omitempty"`
	SecretAccessKey    string `json:"secretAccessKey,omitempty"`
	SessionToken       string `json:"sessionToken,omitempty"`
	ServiceAccountJSON string `json:"serviceAccountJson,omitempty"`
}

func (c *Credential) empty() bool {
	return c.APIKey == "" && c.AccessKeyID == "" && c.SecretAccessKey == "" && c.SessionToken == "" && c.ServiceAccountJSON == ""
}

func credentialFrom(c *spec.Credential) *Credential {
	if c == nil {
		return nil
	}
	// Keys are pasted; surrounding spaces and line breaks are never part of one.
	trim := func(p *string) string { return strings.TrimSpace(deref(p)) }
	return &Credential{APIKey: trim(c.APIKey), AccessKeyID: trim(c.AccessKeyID), SecretAccessKey: trim(c.SecretAccessKey),
		SessionToken: trim(c.SessionToken), ServiceAccountJSON: trim(c.ServiceAccountJSON)}
}

// keyless is a connection that sends no key at all.
func (p *Provider) keyless() bool { return p.Kind == KindCustom && p.AuthType == "none" }

// complete says whether a credential is enough for the connection's kind.
func complete(kind Kind, c *Credential) bool {
	switch kind {
	case KindBedrock:
		return c.AccessKeyID != "" && c.SecretAccessKey != ""
	case KindVertex:
		return c.ServiceAccountJSON != ""
	}
	return c.APIKey != ""
}

// Cipher encrypts connection credentials under the instance root key.
type Cipher interface {
	Encrypt([]byte) ([]byte, error)
	Decrypt([]byte) ([]byte, error)
}

// CipherSource returns the root-key cipher once the KMS has started.
type CipherSource func() (Cipher, error)

// Store keeps connections in vx_ai_providers.
type Store struct {
	logger *slog.Logger
	db     pg.DB
	cipher CipherSource
}

type StoreDeps struct {
	DB     pg.DB
	Cipher CipherSource
}

func NewStore(_ context.Context, logger *slog.Logger, deps *StoreDeps) *Store {
	return &Store{logger: logger.With(slog.String("service", "assistant-connections")), db: deps.DB, cipher: deps.Cipher}
}

const providerColumns = `id, kind, name, model, "fastModel", "deepModel", "baseUrl", "apiStyle", "authType", "authHeaderName", headers,
	region, "cloudProject", "billTo", "timeoutSeconds", "encryptedCredential" IS NOT NULL,
	active, "lastTestedAt", "lastTestOutcome", "lastTestMessage", "lastTestTools", "createdAt", "updatedAt"`

func scanProvider(row pgx.Row) (*Provider, error) {
	var p Provider
	var outcome, message *string
	var headers []byte
	if err := row.Scan(&p.ID, &p.Kind, &p.Name, &p.Model, &p.FastModel, &p.DeepModel, &p.BaseURL, &p.APIStyle, &p.AuthType, &p.AuthHeaderName,
		&headers, &p.Region, &p.CloudProject, &p.BillTo, &p.TimeoutSeconds, &p.HasCredential,
		&p.Active, &p.LastTestedAt, &outcome, &message, &p.LastTestTools, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(headers, &p.Headers); err != nil {
		return nil, fmt.Errorf("headers: %w", err)
	}
	if outcome != nil {
		p.LastTestOutcome = *outcome
	}
	if message != nil {
		p.LastTestMessage = *message
	}
	return &p, nil
}

// fieldErrors turns the v1 rule failures into a 400 whose details name each field.
func fieldErrors(err error) error {
	var errs spec.Errors
	if errors.As(err, &errs) && len(errs) > 0 {
		message := errs[0].Message
		if errs[0].Path != "" {
			message = errs[0].Path + ": " + message
		}
		return errutil.BadRequest("%s", message).WithDetails(map[string]any{"fields": errs})
	}
	return err
}

// fromDocument checks a v1 document and turns it into the stored form. Names are trimmed first,
// so stray spaces are never a reason to refuse.
func fromDocument(doc *spec.Connection) (*Provider, error) {
	doc.Name = strings.TrimSpace(doc.Name)
	if err := CheckConnection(doc); err != nil {
		return nil, fieldErrors(err)
	}
	p := &Provider{Kind: Kind(doc.Kind), Name: doc.Name, Model: doc.Models.Standard, FastModel: deref(doc.Models.Fast), DeepModel: deref(doc.Models.Deep),
		BaseURL: strings.TrimRight(deref(doc.Endpoint), "/"), APIStyle: deref(doc.APIStyle), Region: deref(doc.Region),
		CloudProject: deref(doc.CloudProject), BillTo: deref(doc.BillTo), TimeoutSeconds: defaultTimeout, Headers: doc.Headers}
	if doc.Auth != nil {
		p.AuthType, p.AuthHeaderName = doc.Auth.Type, deref(doc.Auth.HeaderName)
	}
	if doc.TimeoutSeconds != nil {
		p.TimeoutSeconds = *doc.TimeoutSeconds
	}
	if p.Headers == nil {
		p.Headers = []spec.Header{}
	}
	return p, nil
}

func (s *Store) List(ctx context.Context) ([]Provider, error) {
	rows, err := s.db.Replica().Query(ctx, `SELECT `+providerColumns+` FROM vx_ai_providers WHERE "orgId" IS NULL ORDER BY active DESC, "createdAt" ASC`)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load AI connections.").WithErrf("assistant.List: %w", err)
	}
	defer rows.Close()
	providers := []Provider{}
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, errutil.DatabaseErr("Could not load AI connections.").WithErrf("assistant.List scan: %w", err)
		}
		providers = append(providers, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, errutil.DatabaseErr("Could not load AI connections.").WithErrf("assistant.List rows: %w", err)
	}
	return providers, nil
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (*Provider, error) {
	p, err := scanProvider(s.db.Primary().QueryRow(ctx, `SELECT `+providerColumns+` FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL`, pgx.NamedArgs{"id": id}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI connection '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load the AI connection.").WithErrf("assistant.Get(id=%s): %w", id, err)
	}
	return p, nil
}

// Active returns the connection in use and its credential, or nil when none is.
func (s *Store) Active(ctx context.Context) (*Provider, *Credential, error) {
	p, err := scanProvider(s.db.Primary().QueryRow(ctx, `SELECT `+providerColumns+` FROM vx_ai_providers WHERE active AND "orgId" IS NULL`))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, errutil.DatabaseErr("Could not load the AI connection in use.").WithErrf("assistant.Active: %w", err)
	}
	credential, err := s.credential(ctx, p.ID)
	if err != nil {
		return nil, nil, err
	}
	return p, credential, nil
}

func (s *Store) credential(ctx context.Context, id uuid.UUID) (*Credential, error) {
	var blob []byte
	err := s.db.Primary().QueryRow(ctx, `SELECT "encryptedCredential" FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL`, pgx.NamedArgs{"id": id}).Scan(&blob)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load the AI connection.").WithErrf("assistant.credential(id=%s): %w", id, err)
	}
	if len(blob) == 0 {
		return &Credential{}, nil
	}
	c, err := s.cipher()
	if err != nil {
		return nil, errutil.InternalServer("The instance key is unavailable.").WithErrf("assistant.credential: %w", err)
	}
	plain, err := c.Decrypt(blob)
	if err != nil {
		return nil, errutil.InternalServer("The stored key could not be read.").WithErrf("assistant.credential decrypt(id=%s): %w", id, err)
	}
	var credential Credential
	if err := json.Unmarshal(plain, &credential); err != nil {
		return nil, errutil.InternalServer("The stored key could not be read.").WithErrf("assistant.credential parse(id=%s): %w", id, err)
	}
	return &credential, nil
}

// ProviderWithCredential loads a connection for a test or a model list.
func (s *Store) ProviderWithCredential(ctx context.Context, id uuid.UUID) (*Provider, *Credential, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	credential, err := s.credential(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	return p, credential, nil
}

func (s *Store) seal(credential *Credential) ([]byte, error) {
	if credential == nil || credential.empty() {
		return nil, nil
	}
	plain, err := json.Marshal(credential)
	if err != nil {
		return nil, errutil.InternalServer("Could not store the key.").WithErrf("assistant.seal: %w", err)
	}
	c, err := s.cipher()
	if err != nil {
		return nil, errutil.InternalServer("The instance key is unavailable.").WithErrf("assistant.seal: %w", err)
	}
	blob, err := c.Encrypt(plain)
	if err != nil {
		return nil, errutil.InternalServer("Could not store the key.").WithErrf("assistant.seal encrypt: %w", err)
	}
	return blob, nil
}

func missingKey(kind Kind) error {
	message := "Enter the key."
	switch kind {
	case KindBedrock:
		message = "Enter the AWS access key ID and secret access key."
	case KindVertex:
		message = "Paste the service account JSON key."
	}
	return errutil.BadRequest("credential: %s", message).WithDetails(map[string]any{"fields": spec.Errors{{Path: "credential", Message: message}}})
}

// Create stores a new connection. One created active replaces the connection in use.
func (s *Store) Create(ctx context.Context, doc *spec.Connection) (*Provider, error) {
	p, err := fromDocument(doc)
	if err != nil {
		return nil, err
	}
	credential := credentialFrom(doc.Credential)
	if !p.keyless() && (credential == nil || !complete(p.Kind, credential)) {
		return nil, missingKey(p.Kind)
	}
	blob, err := s.seal(credential)
	if err != nil {
		return nil, err
	}
	active := doc.Active != nil && *doc.Active
	headers, _ := json.Marshal(p.Headers)

	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI connection.").WithErrf("assistant.Create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vx_ai_providers WHERE "orgId" IS NULL`).Scan(&count); err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI connection.").WithErrf("assistant.Create count: %w", err)
	}
	if count >= maxProviders {
		return nil, errutil.BadRequest("An instance can keep at most %d AI connections. Remove one first.", maxProviders)
	}
	if active {
		if _, err := tx.Exec(ctx, `UPDATE vx_ai_providers SET active = false WHERE active AND "orgId" IS NULL`); err != nil {
			return nil, errutil.DatabaseErr("Could not save the AI connection.").WithErrf("assistant.Create deactivate: %w", err)
		}
	}
	created, err := scanProvider(tx.QueryRow(ctx, `INSERT INTO vx_ai_providers
		(kind, name, model, "fastModel", "deepModel", "baseUrl", "apiStyle", "authType", "authHeaderName", headers, region, "cloudProject",
		 "billTo", "timeoutSeconds", "encryptedCredential", active)
		VALUES (@kind, @name, @model, @fastModel, @deepModel, @baseUrl, @apiStyle, @authType, @authHeaderName, @headers, @region, @cloudProject,
		 @billTo, @timeoutSeconds, @credential, @active)
		RETURNING `+providerColumns, pgx.NamedArgs{
		"kind": p.Kind, "name": p.Name, "model": p.Model, "fastModel": p.FastModel, "deepModel": p.DeepModel, "baseUrl": p.BaseURL,
		"apiStyle": p.APIStyle, "authType": p.AuthType, "authHeaderName": p.AuthHeaderName, "headers": headers, "region": p.Region,
		"cloudProject": p.CloudProject, "billTo": p.BillTo, "timeoutSeconds": p.TimeoutSeconds, "credential": blob, "active": active,
	}))
	if err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI connection.").WithErrf("assistant.Create insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, errutil.DatabaseErr("Could not save the AI connection.").WithErrf("assistant.Create commit: %w", err)
	}
	return created, nil
}

// Replace stores a whole v1 document over a connection. Without a credential the stored key is
// kept, unless the connection now sends no key. Changing how it is reached clears its last test.
func (s *Store) Replace(ctx context.Context, id uuid.UUID, doc *spec.Connection) (*Provider, error) {
	current, stored, err := s.ProviderWithCredential(ctx, id)
	if err != nil {
		return nil, err
	}
	next, err := fromDocument(doc)
	if err != nil {
		return nil, err
	}
	if next.Kind != current.Kind {
		return nil, errutil.BadRequest("kind: A connection's provider cannot change. Add a new connection instead.").
			WithDetails(map[string]any{"fields": spec.Errors{{Path: "kind", Message: "Cannot change."}}})
	}
	credential := credentialFrom(doc.Credential)
	replaced := credential != nil || (next.keyless() && !stored.empty())
	switch {
	case next.keyless():
		credential = &Credential{}
	case credential == nil:
		credential = stored
	}
	if !next.keyless() && !complete(next.Kind, credential) {
		return nil, missingKey(next.Kind)
	}
	var blob []byte
	if replaced {
		if blob, err = s.seal(credential); err != nil {
			return nil, err
		}
	}
	reach := replaced || next.Model != current.Model || next.FastModel != current.FastModel || next.DeepModel != current.DeepModel ||
		next.BaseURL != current.BaseURL || next.APIStyle != current.APIStyle || next.AuthType != current.AuthType ||
		next.AuthHeaderName != current.AuthHeaderName || !slices.Equal(next.Headers, current.Headers) || next.Region != current.Region ||
		next.CloudProject != current.CloudProject || next.BillTo != current.BillTo
	active := current.Active
	if doc.Active != nil {
		active = *doc.Active
	}
	headers, _ := json.Marshal(next.Headers)

	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not update the AI connection.").WithErrf("assistant.Replace begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if active && !current.Active {
		if _, err := tx.Exec(ctx, `UPDATE vx_ai_providers SET active = false WHERE active AND "orgId" IS NULL AND id <> @id`, pgx.NamedArgs{"id": id}); err != nil {
			return nil, errutil.DatabaseErr("Could not update the AI connection.").WithErrf("assistant.Replace deactivate: %w", err)
		}
	}
	updated, err := scanProvider(tx.QueryRow(ctx, `UPDATE vx_ai_providers SET
		name = @name, model = @model, "fastModel" = @fastModel, "deepModel" = @deepModel, "baseUrl" = @baseUrl, "apiStyle" = @apiStyle,
		"authType" = @authType, "authHeaderName" = @authHeaderName, headers = @headers, region = @region, "cloudProject" = @cloudProject,
		"billTo" = @billTo, "timeoutSeconds" = @timeoutSeconds,
		"encryptedCredential" = CASE WHEN @replaced THEN @credential ELSE "encryptedCredential" END,
		active = @active,
		"lastTestedAt" = CASE WHEN @reach THEN NULL ELSE "lastTestedAt" END,
		"lastTestOutcome" = CASE WHEN @reach THEN NULL ELSE "lastTestOutcome" END,
		"lastTestMessage" = CASE WHEN @reach THEN NULL ELSE "lastTestMessage" END,
		"lastTestTools" = CASE WHEN @reach THEN NULL ELSE "lastTestTools" END
		WHERE id = @id AND "orgId" IS NULL RETURNING `+providerColumns, pgx.NamedArgs{
		"id": id, "name": next.Name, "model": next.Model, "fastModel": next.FastModel, "deepModel": next.DeepModel, "baseUrl": next.BaseURL,
		"apiStyle": next.APIStyle, "authType": next.AuthType, "authHeaderName": next.AuthHeaderName, "headers": headers, "region": next.Region,
		"cloudProject": next.CloudProject, "billTo": next.BillTo, "timeoutSeconds": next.TimeoutSeconds, "replaced": replaced, "credential": blob,
		"active": active, "reach": reach,
	}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI connection '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not update the AI connection.").WithErrf("assistant.Replace(id=%s): %w", id, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, errutil.DatabaseErr("Could not update the AI connection.").WithErrf("assistant.Replace commit: %w", err)
	}
	return updated, nil
}

func (s *Store) Delete(ctx context.Context, id uuid.UUID) (*Provider, error) {
	deleted, err := scanProvider(s.db.Primary().QueryRow(ctx, `DELETE FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL RETURNING `+providerColumns, pgx.NamedArgs{"id": id}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI connection '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not remove the AI connection.").WithErrf("assistant.Delete(id=%s): %w", id, err)
	}
	return deleted, nil
}

// RecordTest stores the outcome of a real connection test, cut at a character boundary.
func (s *Store) RecordTest(ctx context.Context, id uuid.UUID, passed bool, toolCalls *bool, message string, at time.Time) (*Provider, error) {
	outcome := "failed"
	if passed {
		outcome = "passed"
	}
	if utf8.RuneCountInString(message) > maxTestMessage {
		message = string([]rune(message)[:maxTestMessage])
	}
	p, err := scanProvider(s.db.Primary().QueryRow(ctx, `UPDATE vx_ai_providers
		SET "lastTestedAt" = @at, "lastTestOutcome" = @outcome, "lastTestMessage" = @message, "lastTestTools" = @tools
		WHERE id = @id AND "orgId" IS NULL RETURNING `+providerColumns, pgx.NamedArgs{"id": id, "at": at, "outcome": outcome, "message": message, "tools": toolCalls}))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errutil.NotFound("AI connection '%s' was not found.", id)
	}
	if err != nil {
		return nil, errutil.DatabaseErr("Could not record the test.").WithErrf("assistant.RecordTest(id=%s): %w", id, err)
	}
	return p, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ModelFor is the model a persona of this tier runs on: the tier's own model when the
// administrator set one, otherwise the standard model.
func (p *Provider) ModelFor(tier string) string {
	switch {
	case tier == "fast" && p.FastModel != "":
		return p.FastModel
	case tier == "deep" && p.DeepModel != "":
		return p.DeepModel
	}
	return p.Model
}

// Models lists the distinct models the connection is set to run.
func (p *Provider) Models() []string {
	out := []string{p.Model}
	for _, m := range []string{p.FastModel, p.DeepModel} {
		if m != "" && !slices.Contains(out, m) {
			out = append(out, m)
		}
	}
	return out
}

// describe names a connection in messages without exposing anything secret.
func describe(p *Provider) string {
	return fmt.Sprintf("%s (%s, %s)", p.Name, p.Kind, p.Model)
}
