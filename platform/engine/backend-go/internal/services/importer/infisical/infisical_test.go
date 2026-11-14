package infisical

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vaultix-cloud/api/internal/services/importer"
)

const (
	canaryValue  = "postgres://app:canary-value-7f3a@db/app"
	clientSecret = "client-secret-canary"
)

// standIn answers with the response shapes Infisical documents for its v1 login, v1 projects,
// v2 folders and v4 secrets endpoints, and records every query it was sent.
func standIn(t *testing.T, projects int) (*httptest.Server, *[]string) {
	t.Helper()
	seen := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		if r.URL.Path == "/api/v1/auth/universal-auth/login" {
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["clientSecret"] != clientSecret {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = io.WriteString(w, `{"message":"Invalid credentials"}`)
				return
			}
			_, _ = io.WriteString(w, `{"accessToken":"session-token","expiresIn":7200,"accessTokenMaxTTL":7200,"tokenType":"Bearer"}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer session-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/projects":
			offset := 0
			_, _ = fmt.Sscan(r.URL.Query().Get("offset"), &offset)
			items := []string{}
			for i := offset; i < projects && i < offset+pageSize; i++ {
				items = append(items, fmt.Sprintf(`{"id":"p%d","name":"Project %d","slug":"project-%d","type":"secret-manager","environments":[{"id":"e%d","name":"Development","slug":"dev"}]}`, i, i, i, i))
			}
			_, _ = fmt.Fprintf(w, `{"projects":[%s],"totalCount":%d}`, strings.Join(items, ","), projects)
		case "/api/v2/folders":
			_, _ = io.WriteString(w, `{"folders":[{"id":"f1","name":"db","relativePath":"/app/db","envId":"e0","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`)
		case "/api/v2/secret-imports":
			if r.URL.Query().Get("path") == "/app/db" {
				_, _ = io.WriteString(w, `{"message":"ok","secretImports":[
					{"id":"i1","importPath":"/shared","position":1,"folderId":"f1","isReplication":false,"importEnv":{"id":"e9","name":"Production","slug":"prod"},"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
					{"id":"i2","importPath":"/","position":2,"folderId":"f1","isReplication":true,"importEnv":{"id":"e8","name":"Dev","slug":"dev","projectId":"other-project"},"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`)
				return
			}
			_, _ = io.WriteString(w, `{"message":"ok","secretImports":[]}`)
		case "/api/v4/secrets":
			_, _ = io.WriteString(w, `{"secrets":[
				{"id":"s1","_id":"s1","workspace":"p0","environment":"dev","version":3,"type":"shared","secretKey":"DATABASE_URL","secretValue":"`+canaryValue+`","secretComment":"primary","secretPath":"/app/db","secretValueHidden":false,"tags":[{"id":"t","slug":"backend","name":"Backend"}],"secretMetadata":[{"key":"owner","value":"payments","isEncrypted":false},{"key":"vault","value":"","isEncrypted":true}],"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
				{"id":"s2","_id":"s2","workspace":"p0","environment":"dev","version":1,"type":"shared","secretKey":"API_URL","secretValue":"${HOST}/v1 and ${prod.app.db.DATABASE_URL}","secretComment":"","secretPath":"/","secretValueHidden":false,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
				{"id":"s3","_id":"s3","workspace":"p0","environment":"dev","version":1,"type":"personal","secretKey":"DEBUG","secretValue":"true","secretComment":"","secretPath":"/","secretValueHidden":false,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"},
				{"id":"s4","_id":"s4","workspace":"p0","environment":"dev","version":1,"type":"shared","secretKey":"ROOT_KEY","secretValue":"","secretComment":"","secretPath":"/","secretValueHidden":true,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server, &seen
}

func TestSnapshot_NormalizesProjectsFoldersSecretsAndNamesEveryGap(t *testing.T) {
	server, seen := standIn(t, 1)
	client, err := New(server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SignIn(context.Background(), Credentials{ClientID: "id", ClientSecret: clientSecret}); err != nil {
		t.Fatal(err)
	}
	snap, err := client.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snap.Source.Kind != "infisical" || snap.Source.APIVersions["secrets"] != "v4" {
		t.Fatalf("source %+v", snap.Source)
	}
	env := snap.Projects[0].Environments[0]
	if env.Slug != "dev" || len(env.Folders) != 1 || env.Folders[0] != "/app/db" || len(env.Secrets) != 2 {
		t.Fatalf("environment %+v", env)
	}
	db := env.Secrets[0]
	if db.Address != (importer.Address{Environment: "dev", Folder: "/app/db", Name: "DATABASE_URL"}) || db.Value != canaryValue ||
		db.Comment != "primary" || len(db.Tags) != 1 || len(db.Metadata) != 1 {
		t.Fatalf("secret %+v", db)
	}
	refs := env.Secrets[1].References
	if len(refs) != 2 || refs[0].Target != (importer.Address{Environment: "dev", Folder: "/", Name: "HOST"}) ||
		refs[1].Target != (importer.Address{Environment: "prod", Folder: "/app/db", Name: "DATABASE_URL"}) {
		t.Fatalf("references %+v", refs)
	}
	reasons := map[string]int{}
	for _, g := range snap.Gaps {
		reasons[g.Reason]++
		if g.Message == "" || g.Where == "" {
			t.Fatalf("a gap must say where and what to do: %+v", g)
		}
	}
	imports := env.Imports
	if snap.Source.Precedence != "last-wins" || len(imports) != 2 ||
		imports[0] != (importer.Import{Folder: "/app/db", From: importer.ImportFrom{Environment: "prod", Folder: "/shared"}, Position: 1}) ||
		imports[1].From.Project != "other-project" || !imports[1].Replication {
		t.Fatalf("imports %+v precedence %q", imports, snap.Source.Precedence)
	}
	if reasons[importer.GapPersonal] != 1 || reasons[importer.GapUnreadable] != 1 || reasons[importer.GapUnsupported] != 1 {
		t.Fatalf("gaps %v", reasons)
	}
	var secretsQuery string
	for _, q := range *seen {
		if strings.HasPrefix(q, "GET /api/v4/secrets?") {
			secretsQuery = q
		}
	}
	for _, flag := range []string{"viewSecretValue=true", "expandSecretReferences=false", "includeImports=false", "includePersonalOverrides=false", "recursive=true"} {
		if !strings.Contains(secretsQuery, flag) {
			t.Fatalf("every option must be explicit; %q missing from %s", flag, secretsQuery)
		}
	}
	raw, _ := json.Marshal(snap)
	if strings.Contains(string(raw), canaryValue) || strings.Contains(string(raw), clientSecret) {
		t.Fatal("a snapshot's JSON must never carry a value or credential")
	}
}

func TestSnapshot_PagesThroughProjects(t *testing.T) {
	server, _ := standIn(t, 230)
	client, _ := New(server.URL, nil)
	_ = client.SignIn(context.Background(), Credentials{ClientID: "id", ClientSecret: clientSecret})
	snap, err := client.Snapshot(context.Background())
	if err != nil || len(snap.Projects) != 230 {
		t.Fatalf("projects %d err %v", len(snap.Projects), err)
	}
}

func TestSignInAndAddress_Refusals(t *testing.T) {
	server, _ := standIn(t, 0)
	client, _ := New(server.URL, nil)
	err := client.SignIn(context.Background(), Credentials{ClientID: "id", ClientSecret: "wrong"})
	if err == nil || !strings.Contains(err.Error(), "refused the machine identity") || strings.Contains(err.Error(), "wrong") {
		t.Fatalf("sign-in refusal %v", err)
	}
	for _, address := range []string{"http://infisical.example.com", "https://user:pw@infisical.example.com", "ftp://x", "https://x?y=1"} {
		if _, err := New(address, nil); err == nil {
			t.Fatalf("%s accepted", address)
		}
	}
	if _, err := New(CloudEU, nil); err != nil {
		t.Fatal(err)
	}
}
