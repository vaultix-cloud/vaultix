// Package infisical reads a customer's Infisical organization through Infisical's own public API,
// signed in as one of their machine identities (Universal Auth), and normalizes it into an
// importer.Snapshot (docs/0127). It depends only on Infisical's API, never on Vaultix still
// speaking it. Every query states each option explicitly, because Infisical's defaults differ
// between API versions (docs/0128).
package infisical

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/vaultix-cloud/api/internal/services/importer"
)

const (
	CloudUS = "https://us.infisical.com"
	CloudEU = "https://eu.infisical.com"

	pageSize         = 100
	maxPages         = 100
	maxResponseBytes = 32 << 20
)

// The Infisical API versions this adapter reads, recorded on every snapshot.
var apiVersions = map[string]string{"login": "v1", "projects": "v1", "folders": "v2", "secrets": "v4"}

type Credentials struct {
	ClientID     string
	ClientSecret string
	// OrganizationSlug scopes the session when the identity belongs to several organizations.
	OrganizationSlug string
}

type Client struct {
	base  string
	http  *http.Client
	token string
	now   func() time.Time
}

// Error is a failure the importing person can act on; it never contains a credential or value.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

// New checks the address: https only, except a loopback address used by tests and local trials.
func New(address string, client *http.Client) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(address, "/"))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		return nil, &Error{Status: http.StatusBadRequest, Message: "Use the https address of the Infisical instance, such as " + CloudUS + "."}
	}
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	// A credential is never replayed to a host the person did not name.
	guarded := *client
	guarded.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{base: u.String(), http: &guarded, now: time.Now}, nil
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body any, into any) error {
	address := c.base + path
	if len(query) > 0 {
		address += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(raw))
	}
	request, err := http.NewRequestWithContext(ctx, method, address, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return &Error{Status: http.StatusBadGateway, Message: "Infisical could not be reached at " + c.base + "."}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return &Error{Status: http.StatusBadGateway, Message: "Infisical's answer could not be read."}
	}
	switch {
	case response.StatusCode == http.StatusUnauthorized:
		return &Error{Status: http.StatusBadRequest, Message: "Infisical refused the machine identity. Check its client ID and secret."}
	case response.StatusCode == http.StatusForbidden:
		return &Error{Status: http.StatusBadRequest, Message: "The machine identity may not read this in Infisical. Give it read access to the projects to import."}
	case response.StatusCode >= 400:
		var failure struct {
			Message any `json:"message"`
		}
		_ = json.Unmarshal(raw, &failure)
		detail := ""
		if text, ok := failure.Message.(string); ok && len(text) < 300 {
			detail = ": " + text
		}
		return &Error{Status: http.StatusBadGateway, Message: fmt.Sprintf("Infisical answered %d%s", response.StatusCode, detail)}
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return &Error{Status: http.StatusBadGateway, Message: "Infisical answered in an unexpected format."}
	}
	return nil
}

// SignIn exchanges the machine identity's client ID and secret for a short-lived token.
func (c *Client) SignIn(ctx context.Context, creds Credentials) error {
	if creds.ClientID == "" || creds.ClientSecret == "" {
		return &Error{Status: http.StatusBadRequest, Message: "Enter the machine identity's client ID and client secret."}
	}
	body := map[string]string{"clientId": creds.ClientID, "clientSecret": creds.ClientSecret}
	if creds.OrganizationSlug != "" {
		body["organizationSlug"] = creds.OrganizationSlug
	}
	var answer struct {
		AccessToken string `json:"accessToken"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/v1/auth/universal-auth/login", nil, body, &answer); err != nil {
		return err
	}
	if answer.AccessToken == "" {
		return &Error{Status: http.StatusBadGateway, Message: "Infisical signed in but returned no token."}
	}
	c.token = answer.AccessToken
	return nil
}

type project struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Slug         string `json:"slug"`
	Type         string `json:"type"`
	Environments []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"environments"`
}

func (c *Client) projects(ctx context.Context) ([]project, error) {
	var all []project
	for page := 0; page < maxPages; page++ {
		var answer struct {
			Projects   []project `json:"projects"`
			TotalCount int       `json:"totalCount"`
		}
		query := url.Values{"type": {"secret-manager"}, "limit": {strconv.Itoa(pageSize)}, "offset": {strconv.Itoa(page * pageSize)}}
		if err := c.do(ctx, http.MethodGet, "/api/v1/projects", query, nil, &answer); err != nil {
			return nil, err
		}
		all = append(all, answer.Projects...)
		if len(answer.Projects) < pageSize || len(all) >= answer.TotalCount {
			return all, nil
		}
	}
	return nil, &Error{Status: http.StatusBadGateway, Message: fmt.Sprintf("More than %d projects; import fewer at a time.", maxPages*pageSize)}
}

type secret struct {
	Type              string `json:"type"`
	SecretKey         string `json:"secretKey"`
	SecretValue       string `json:"secretValue"`
	SecretComment     string `json:"secretComment"`
	SecretPath        string `json:"secretPath"`
	SecretValueHidden bool   `json:"secretValueHidden"`
	Tags              []struct {
		Slug string `json:"slug"`
	} `json:"tags"`
	SecretMetadata []struct {
		Key         string `json:"key"`
		Value       string `json:"value"`
		IsEncrypted bool   `json:"isEncrypted"`
	} `json:"secretMetadata"`
}

// environment reads one environment's folders and secrets. References stay unexpanded and
// imports are not merged in, so the snapshot holds what is stored, not what it resolves to.
func (c *Client) environment(ctx context.Context, projectID, slug string) ([]string, []secret, error) {
	var folders struct {
		Folders []struct {
			RelativePath string `json:"relativePath"`
			Name         string `json:"name"`
		} `json:"folders"`
	}
	folderQuery := url.Values{"projectId": {projectID}, "environment": {slug}, "path": {"/"}, "recursive": {"true"}}
	if err := c.do(ctx, http.MethodGet, "/api/v2/folders", folderQuery, nil, &folders); err != nil {
		return nil, nil, err
	}
	paths := []string{}
	for _, f := range folders.Folders {
		path := f.RelativePath
		if path == "" {
			path = "/" + f.Name
		}
		paths = append(paths, path)
	}
	var secrets struct {
		Secrets []secret `json:"secrets"`
	}
	secretQuery := url.Values{"projectId": {projectID}, "environment": {slug}, "secretPath": {"/"}, "recursive": {"true"},
		"viewSecretValue": {"true"}, "expandSecretReferences": {"false"}, "includeImports": {"false"}, "includePersonalOverrides": {"false"}}
	if err := c.do(ctx, http.MethodGet, "/api/v4/secrets", secretQuery, nil, &secrets); err != nil {
		return nil, nil, err
	}
	return paths, secrets.Secrets, nil
}

// Snapshot reads every secret-manager project the identity can see.
func (c *Client) Snapshot(ctx context.Context) (*importer.Snapshot, error) {
	if c.token == "" {
		return nil, errors.New("sign in first")
	}
	projects, err := c.projects(ctx)
	if err != nil {
		return nil, err
	}
	snap := &importer.Snapshot{Source: importer.Source{Kind: "infisical", Address: c.base, APIVersions: apiVersions, ReadAt: c.now().UTC()},
		Projects: []importer.Project{}, Gaps: []importer.Gap{}}
	for _, p := range projects {
		out := importer.Project{SourceID: p.ID, Name: p.Name, Slug: p.Slug, Environments: []importer.Environment{}}
		for _, env := range p.Environments {
			folders, secrets, err := c.environment(ctx, p.ID, env.Slug)
			if err != nil {
				return nil, err
			}
			e := importer.Environment{SourceID: env.ID, Name: env.Name, Slug: env.Slug, Folders: folders, Secrets: []importer.Secret{}}
			for _, s := range secrets {
				folder := s.SecretPath
				if folder == "" {
					folder = "/"
				}
				where := fmt.Sprintf("%s/%s%s/%s", p.Slug, env.Slug, strings.TrimSuffix(folder, "/"), s.SecretKey)
				switch {
				case s.Type == "personal":
					snap.Gaps = append(snap.Gaps, importer.Gap{Kind: "secret", Reason: importer.GapPersonal, Where: where,
						Message: "A person's own override. They can add it again in Vaultix as their personal value."})
					continue
				case s.SecretValueHidden:
					snap.Gaps = append(snap.Gaps, importer.Gap{Kind: "secret", Reason: importer.GapUnreadable, Where: where,
						Message: "The machine identity may not read this value. Give it read access in Infisical, or enter the value in Vaultix."})
					continue
				}
				item := importer.Secret{Address: importer.Address{Environment: env.Slug, Folder: folder, Name: s.SecretKey},
					Value: s.SecretValue, Comment: s.SecretComment, References: References(s.SecretValue, env.Slug, folder)}
				for _, t := range s.Tags {
					item.Tags = append(item.Tags, t.Slug)
				}
				for _, m := range s.SecretMetadata {
					if m.IsEncrypted {
						snap.Gaps = append(snap.Gaps, importer.Gap{Kind: "metadata", Reason: importer.GapUnsupported, Where: where + "#" + m.Key,
							Message: "Encrypted metadata is not imported. Add it again in Vaultix."})
						continue
					}
					item.Metadata = append(item.Metadata, importer.Pair{Key: m.Key, Value: m.Value})
				}
				e.Secrets = append(e.Secrets, item)
			}
			out.Environments = append(out.Environments, e)
		}
		snap.Projects = append(snap.Projects, out)
		snap.Gaps = append(snap.Gaps, importer.Gap{Kind: "secret-imports", Reason: importer.GapUnsupported, Where: p.Slug,
			Message: "Secret imports between folders and environments are not brought over yet; they are next in docs/0127's order."})
	}
	return snap, nil
}

// Infisical writes a reference as ${KEY} (same environment and folder) or
// ${environment.folder.subfolder.KEY}. Each becomes a structured target.
var referencePattern = regexp.MustCompile(`\$\{([^{}\s]+)\}`)

func References(value, environment, folder string) []importer.Reference {
	var refs []importer.Reference
	for _, match := range referencePattern.FindAllStringSubmatch(value, -1) {
		parts := strings.Split(match[1], ".")
		target := importer.Address{Environment: environment, Folder: folder, Name: parts[len(parts)-1]}
		if len(parts) > 1 {
			target.Environment = parts[0]
			target.Folder = "/" + strings.Join(parts[1:len(parts)-1], "/")
		}
		refs = append(refs, importer.Reference{Source: match[0], Target: target})
	}
	return refs
}
