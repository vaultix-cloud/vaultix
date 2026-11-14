package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.yaml.in/yaml/v3"

	"github.com/vaultix-cloud/api/internal/database/pg"
	"github.com/vaultix-cloud/api/internal/libs/errutil"
	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
)

// Role is what a persona does in a conversation (docs/0124).
type Role string

const (
	RoleRouter     Role = "router"
	RoleSpecialist Role = "specialist"
	RoleGuard      Role = "guard"
)

// Domains are the canonical interaction domains (docs/interaction/workflows.json),
// one MCP warp point each at /api/vx/v1/<domain>/mcp.
var Domains = spec.Domains

var (
	Roles       = []Role{RoleRouter, RoleSpecialist, RoleGuard}
	Tiers       = spec.Tiers
	slugPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)
)

// Persona is a default persona from platform/engine/ai/personas, possibly changed by an
// administrator, or a custom one: a vaultix.ai-persona.v1 document (docs/0126). It narrows what
// the assistant does; it never grants anything.
type Persona struct {
	Slug          string
	Name          string
	Role          Role
	Domains       []string
	Tier          string
	Model         string
	Description   string
	Instructions  string
	ProviderID    *uuid.UUID
	ModelSettings *spec.ModelSettings
	Tools         []string // nil: every read-only tool of its domains
	Handoffs      []string // router only; nil: every enabled specialist
	MemoryUse     string
	Enabled       bool
	BuiltIn       bool
	Customized    bool
	UpdatedAt     *time.Time
}

// PersonaView is how a persona is shown: its v1 document plus what the server knows about it.
type PersonaView struct {
	spec.Persona
	ID         string     `json:"id"`
	BuiltIn    bool       `json:"builtIn"`
	Customized bool       `json:"customized"`
	UpdatedAt  *time.Time `json:"updatedAt"`
}

func (p *Persona) View() PersonaView {
	enabled := p.Enabled
	doc := spec.Persona{SchemaVersion: spec.PersonaVersion, Slug: p.Slug, Name: p.Name, Description: p.Description, Role: string(p.Role),
		Domains: p.Domains, Instructions: p.Instructions, Model: spec.PersonaModel{Tier: p.Tier, ID: optional(p.Model)},
		ModelSettings: p.ModelSettings, Tools: p.Tools, Handoffs: p.Handoffs, Memory: &spec.MemoryUse{Use: p.MemoryUse}, Enabled: &enabled}
	if p.ProviderID != nil {
		id := p.ProviderID.String()
		doc.Model.ConnectionID = &id
	}
	return PersonaView{Persona: doc, ID: "vaultix.persona." + p.Slug, BuiltIn: p.BuiltIn, Customized: p.Customized, UpdatedAt: p.UpdatedAt}
}

// personaFrom checks a v1 document, after trimming the text a person typed, and turns it into
// the stored form.
func personaFrom(doc *spec.Persona) (*Persona, error) {
	doc.Name, doc.Description, doc.Instructions = strings.TrimSpace(doc.Name), strings.TrimSpace(doc.Description), strings.TrimSpace(doc.Instructions)
	if err := CheckPersona(doc); err != nil {
		return nil, fieldErrors(err)
	}
	p := &Persona{Slug: doc.Slug, Name: doc.Name, Role: Role(doc.Role), Domains: doc.Domains, Tier: doc.Model.Tier, Model: deref(doc.Model.ID),
		Description: doc.Description, Instructions: doc.Instructions, ModelSettings: doc.ModelSettings, Tools: doc.Tools,
		Handoffs: doc.Handoffs, MemoryUse: "all", Enabled: doc.Enabled == nil || *doc.Enabled}
	if doc.Memory != nil {
		p.MemoryUse = doc.Memory.Use
	}
	if doc.Model.ConnectionID != nil {
		id, err := uuid.Parse(*doc.Model.ConnectionID)
		if err != nil {
			return nil, errutil.BadRequest("model.connectionId: Choose a connection.")
		}
		p.ProviderID = &id
	}
	return p, nil
}

// LoadDefaultPersonas reads <dir>/personas/<slug>/PERSONA.md: front matter that is a
// vaultix.ai-persona.v1 document without instructions, and the instructions as the body
// (docs/0126). The folder name is the slug and must match the file's slug.
func LoadDefaultPersonas(dir string) ([]Persona, error) {
	entries, err := os.ReadDir(filepath.Join(dir, "personas"))
	if err != nil {
		return nil, fmt.Errorf("reading default personas: %w", err)
	}
	personas := []Persona{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := entry.Name()
		raw, err := os.ReadFile(filepath.Join(dir, "personas", slug, "PERSONA.md"))
		if err != nil {
			return nil, fmt.Errorf("persona %s: %w", slug, err)
		}
		persona, err := parsePersona(slug, raw)
		if err != nil {
			return nil, fmt.Errorf("persona %s: %w", slug, err)
		}
		personas = append(personas, *persona)
	}
	if len(personas) == 0 {
		return nil, errors.New("no default personas found")
	}
	routers := 0
	for _, p := range personas {
		if p.Role == RoleRouter {
			routers++
		}
	}
	if routers != 1 {
		return nil, fmt.Errorf("default personas need exactly one router, found %d", routers)
	}
	sort.Slice(personas, func(i, j int) bool { return personaOrder(&personas[i]) < personaOrder(&personas[j]) })
	return personas, nil
}

func personaOrder(p *Persona) string {
	return fmt.Sprintf("%d-%s", slices.Index(Roles, p.Role), p.Slug)
}

func parsePersona(slug string, raw []byte) (*Persona, error) {
	raw = bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	if !bytes.HasPrefix(raw, []byte("---\n")) {
		return nil, errors.New("missing front matter")
	}
	front, body, found := bytes.Cut(raw[4:], []byte("\n---\n"))
	if !found {
		return nil, errors.New("front matter is not closed")
	}
	var file spec.Persona
	decoder := yaml.NewDecoder(bytes.NewReader(front))
	decoder.KnownFields(true)
	if err := decoder.Decode(&file); err != nil {
		return nil, fmt.Errorf("front matter: %w", err)
	}
	if file.Slug != slug {
		return nil, fmt.Errorf("slug %q must match its folder %q", file.Slug, slug)
	}
	file.Instructions = string(body)
	p, err := personaFrom(&file)
	if err != nil {
		return nil, err
	}
	p.BuiltIn = true
	return p, nil
}

// Personas merges the shipped defaults with what administrators changed or added.
type Personas struct {
	logger   *slog.Logger
	db       pg.DB
	defaults []Persona
}

type PersonasDeps struct {
	DB       pg.DB
	Defaults []Persona
}

func NewPersonas(_ context.Context, logger *slog.Logger, deps *PersonasDeps) *Personas {
	return &Personas{logger: logger.With(slog.String("service", "assistant-personas")), db: deps.DB, defaults: deps.Defaults}
}

const personaColumns = `slug, name, role, tier, model, description, instructions, domains, "providerId", "modelSettings", tools, handoffs,
	"memoryUse", enabled, "builtIn", "updatedAt"`

func scanPersona(row pgx.Row) (*Persona, error) {
	var p Persona
	var role string
	var settings []byte
	var updated time.Time
	if err := row.Scan(&p.Slug, &p.Name, &role, &p.Tier, &p.Model, &p.Description, &p.Instructions, &p.Domains, &p.ProviderID,
		&settings, &p.Tools, &p.Handoffs, &p.MemoryUse, &p.Enabled, &p.BuiltIn, &updated); err != nil {
		return nil, err
	}
	if len(settings) > 0 {
		if err := json.Unmarshal(settings, &p.ModelSettings); err != nil {
			return nil, fmt.Errorf("modelSettings: %w", err)
		}
	}
	p.Role, p.Customized, p.UpdatedAt = Role(role), true, &updated
	return &p, nil
}

func (s *Personas) rows(ctx context.Context) (map[string]*Persona, error) {
	rows, err := s.db.Primary().Query(ctx, `SELECT `+personaColumns+` FROM vx_ai_personas WHERE "orgId" IS NULL`)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not load AI personas.").WithErrf("assistant.personas: %w", err)
	}
	defer rows.Close()
	out := map[string]*Persona{}
	for rows.Next() {
		p, err := scanPersona(rows)
		if err != nil {
			return nil, errutil.DatabaseErr("Could not load AI personas.").WithErrf("assistant.personas scan: %w", err)
		}
		out[p.Slug] = p
	}
	if err := rows.Err(); err != nil {
		return nil, errutil.DatabaseErr("Could not load AI personas.").WithErrf("assistant.personas rows: %w", err)
	}
	return out, nil
}

// List returns every persona: the defaults first, as changed, then custom ones.
func (s *Personas) List(ctx context.Context) ([]Persona, error) {
	rows, err := s.rows(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Persona, 0, len(s.defaults)+len(rows))
	for _, d := range s.defaults {
		if row, ok := rows[d.Slug]; ok && row.BuiltIn {
			row.Role = d.Role
			out = append(out, *row)
			delete(rows, d.Slug)
			continue
		}
		out = append(out, d)
	}
	custom := make([]Persona, 0, len(rows))
	for _, row := range rows {
		if !row.BuiltIn {
			custom = append(custom, *row)
		}
	}
	sort.Slice(custom, func(i, j int) bool { return personaOrder(&custom[i]) < personaOrder(&custom[j]) })
	return append(out, custom...), nil
}

func (s *Personas) find(ctx context.Context, slug string) (*Persona, error) {
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].Slug == slug {
			return &all[i], nil
		}
	}
	return nil, errutil.NotFound("Persona '%s' was not found.", slug)
}

func (s *Personas) isDefault(slug string) *Persona {
	for i := range s.defaults {
		if s.defaults[i].Slug == slug {
			return &s.defaults[i]
		}
	}
	return nil
}

// checkReferences confirms that what a persona names exists: its connection, and for the router,
// specialists to hand off to.
func (s *Personas) checkReferences(ctx context.Context, p *Persona) error {
	if p.ProviderID != nil {
		var exists bool
		if err := s.db.Primary().QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vx_ai_providers WHERE id = @id AND "orgId" IS NULL)`,
			pgx.NamedArgs{"id": *p.ProviderID}).Scan(&exists); err != nil {
			return errutil.DatabaseErr("Could not save the persona.").WithErrf("assistant.personas connection: %w", err)
		}
		if !exists {
			return errutil.BadRequest("model.connectionId: AI connection '%s' was not found.", *p.ProviderID)
		}
	}
	if len(p.Handoffs) > 0 {
		all, err := s.List(ctx)
		if err != nil {
			return err
		}
		for _, slug := range p.Handoffs {
			if !slices.ContainsFunc(all, func(o Persona) bool { return o.Slug == slug && o.Role == RoleSpecialist }) {
				return errutil.BadRequest("handoffs: '%s' is not a specialist.", slug)
			}
		}
	}
	return nil
}

func (s *Personas) save(ctx context.Context, p *Persona) (*Persona, error) {
	if err := s.checkReferences(ctx, p); err != nil {
		return nil, err
	}
	var settings []byte
	if p.ModelSettings != nil {
		settings, _ = json.Marshal(p.ModelSettings)
	}
	_, err := s.db.Primary().Exec(ctx, `INSERT INTO vx_ai_personas
		(slug, name, role, tier, model, description, instructions, domains, "providerId", "modelSettings", tools, handoffs, "memoryUse", enabled, "builtIn")
		VALUES (@slug, @name, @role, @tier, @model, @description, @instructions, @domains, @providerId, @settings, @tools, @handoffs, @memoryUse, @enabled, @builtIn)
		ON CONFLICT (slug) WHERE "orgId" IS NULL DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, tier = EXCLUDED.tier, model = EXCLUDED.model,
		description = EXCLUDED.description, instructions = EXCLUDED.instructions, domains = EXCLUDED.domains, "providerId" = EXCLUDED."providerId",
		"modelSettings" = EXCLUDED."modelSettings", tools = EXCLUDED.tools, handoffs = EXCLUDED.handoffs, "memoryUse" = EXCLUDED."memoryUse",
		enabled = EXCLUDED.enabled`, pgx.NamedArgs{
		"slug": p.Slug, "name": p.Name, "role": string(p.Role), "tier": p.Tier, "model": p.Model, "description": p.Description,
		"instructions": p.Instructions, "domains": p.Domains, "providerId": p.ProviderID, "settings": settings, "tools": p.Tools,
		"handoffs": p.Handoffs, "memoryUse": p.MemoryUse, "enabled": p.Enabled, "builtIn": p.BuiltIn,
	})
	if err != nil {
		return nil, errutil.DatabaseErr("Could not save the persona.").WithErrf("assistant.personas save(slug=%s): %w", p.Slug, err)
	}
	return s.find(ctx, p.Slug)
}

// Create adds a custom persona. Default slugs are taken, and there is one router.
func (s *Personas) Create(ctx context.Context, doc *spec.Persona) (*Persona, error) {
	p, err := personaFrom(doc)
	if err != nil {
		return nil, err
	}
	if s.isDefault(p.Slug) != nil {
		return nil, errutil.BadRequest("slug: '%s' is a default persona. Change it instead of creating another.", p.Slug)
	}
	if _, err := s.find(ctx, p.Slug); err == nil {
		return nil, errutil.BadRequest("slug: A persona named '%s' already exists.", p.Slug)
	}
	if p.Role == RoleRouter {
		return nil, errutil.BadRequest("role: There is one router, Clyffy. Add specialists or guards instead.")
	}
	return s.save(ctx, p)
}

// Replace stores a whole v1 document over a persona. A default keeps its slug and role.
func (s *Personas) Replace(ctx context.Context, slug string, doc *spec.Persona) (*Persona, error) {
	current, err := s.find(ctx, slug)
	if err != nil {
		return nil, err
	}
	next, err := personaFrom(doc)
	if err != nil {
		return nil, err
	}
	if next.Slug != slug {
		return nil, errutil.BadRequest("slug: A persona's short name cannot change.")
	}
	if current.BuiltIn && next.Role != current.Role {
		return nil, errutil.BadRequest("role: A default persona keeps its role.")
	}
	if !current.BuiltIn && next.Role == RoleRouter {
		return nil, errutil.BadRequest("role: There is one router, Clyffy.")
	}
	next.BuiltIn = current.BuiltIn
	return s.save(ctx, next)
}

// Reset returns a default persona to the shipped text and settings.
func (s *Personas) Reset(ctx context.Context, slug string) (*Persona, error) {
	if s.isDefault(slug) == nil {
		return nil, errutil.BadRequest("Only default personas can be reset. Remove a custom persona instead.")
	}
	if _, err := s.db.Primary().Exec(ctx, `DELETE FROM vx_ai_personas WHERE slug = @slug AND "orgId" IS NULL`, pgx.NamedArgs{"slug": slug}); err != nil {
		return nil, errutil.DatabaseErr("Could not reset the persona.").WithErrf("assistant.personas reset(slug=%s): %w", slug, err)
	}
	return s.find(ctx, slug)
}

// Delete removes a custom persona and the memories that applied only to it, which would
// otherwise point at nothing. Defaults are turned off or reset instead.
func (s *Personas) Delete(ctx context.Context, slug string) (*Persona, error) {
	if s.isDefault(slug) != nil {
		return nil, errutil.BadRequest("'%s' is a default persona. Turn it off or reset it instead.", slug)
	}
	current, err := s.find(ctx, slug)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Primary().Begin(ctx)
	if err != nil {
		return nil, errutil.DatabaseErr("Could not remove the persona.").WithErrf("assistant.personas delete begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, statement := range []string{
		`DELETE FROM vx_ai_memories WHERE persona = @slug AND "orgId" IS NULL`,
		`DELETE FROM vx_ai_personas WHERE slug = @slug AND "orgId" IS NULL`,
	} {
		if _, err := tx.Exec(ctx, statement, pgx.NamedArgs{"slug": slug}); err != nil {
			return nil, errutil.DatabaseErr("Could not remove the persona.").WithErrf("assistant.personas delete(slug=%s): %w", slug, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, errutil.DatabaseErr("Could not remove the persona.").WithErrf("assistant.personas delete commit: %w", err)
	}
	return current, nil
}
