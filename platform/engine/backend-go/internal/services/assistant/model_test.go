package assistant

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
)

const canaryKey = "sk-canary-0e1d5f"

func chatWithTool() *ChatRequest {
	return &ChatRequest{
		System:    "system text",
		MaxTokens: 100,
		Tools:     []ToolSpec{{Name: "vaultix__secrets__references", Description: "List references", InputSchema: json.RawMessage(`{"type":"object"}`)}},
		Turns: []Turn{
			{Role: "user", Text: "list my secrets"},
			{Role: "assistant", ToolCalls: []ToolCall{{ID: "call_1", Name: "vaultix__secrets__references", Arguments: json.RawMessage(`{"projectId":"p"}`)}}},
			{Role: "tool", Results: []ToolResult{{CallID: "call_1", Content: "DATABASE_URL", IsError: false}}},
		},
	}
}

func readJSON(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("body is not JSON: %s", raw)
	}
	return body
}

func TestAnthropicModel_SendsMessagesAndParsesToolUse(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != canaryKey || r.Header.Get("anthropic-version") != anthropicVersion {
			t.Errorf("unexpected request %s key=%q version=%q", r.URL.Path, r.Header.Get("x-api-key"), r.Header.Get("anthropic-version"))
		}
		got = readJSON(t, r)
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"Looking."},{"type":"tool_use","id":"tu_2","name":"vaultix__guidance__get","input":{"guide":"references"}}]}`)
	}))
	defer server.Close()

	model, err := NewModel(&Provider{Kind: KindAnthropic, Model: "claude-sonnet-5-5", BaseURL: server.URL}, &Credential{APIKey: canaryKey}, nil)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := model.Chat(context.Background(), chatWithTool())
	if err != nil {
		t.Fatal(err)
	}
	if got["model"] != "claude-sonnet-5-5" || got["system"] != "system text" || got["anthropic_version"] != nil {
		t.Fatalf("direct API body is wrong: %v", got)
	}
	messages := got["messages"].([]any)
	if len(messages) != 3 {
		t.Fatalf("want 3 messages, got %d", len(messages))
	}
	result := messages[2].(map[string]any)["content"].([]any)[0].(map[string]any)
	if messages[2].(map[string]any)["role"] != "user" || result["type"] != "tool_result" || result["tool_use_id"] != "call_1" {
		t.Fatalf("tool result was not sent as a user tool_result: %v", messages[2])
	}
	if answer.Text != "Looking." || len(answer.ToolCalls) != 1 || answer.ToolCalls[0].Name != "vaultix__guidance__get" ||
		string(answer.ToolCalls[0].Arguments) != `{"guide":"references"}` {
		t.Fatalf("answer parsed wrong: %+v", answer)
	}
}

func TestBedrockModel_SignsAndEscapesModelID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/model/anthropic.claude-sonnet-5-5-v1%3A0/invoke" {
			t.Errorf("path %q", r.URL.EscapedPath())
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY0001/") ||
			!strings.Contains(r.Header.Get("Authorization"), "/us-east-1/bedrock/aws4_request") {
			t.Errorf("not SigV4 for bedrock: %q", r.Header.Get("Authorization"))
		}
		body := readJSON(t, r)
		if body["anthropic_version"] != bedrockAnthropicBody || body["model"] != nil {
			t.Errorf("bedrock body: %v", body)
		}
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"OK"}]}`)
	}))
	defer server.Close()

	model, err := NewModel(&Provider{Kind: KindBedrock, Model: "anthropic.claude-sonnet-5-5-v1:0", Region: "us-east-1", BaseURL: server.URL},
		&Credential{AccessKeyID: "AKIAEXAMPLEKEY0001", SecretAccessKey: "secret"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := model.Chat(context.Background(), &ChatRequest{MaxTokens: 8, Turns: []Turn{{Role: "user", Text: "hi"}}})
	if err != nil || answer.Text != "OK" {
		t.Fatalf("answer=%+v err=%v", answer, err)
	}
}

func TestVertexModel_ExchangesServiceAccountForToken(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	tokens := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			tokens++
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"access_token":"vertex-token","token_type":"Bearer","expires_in":3600}`)
			return
		}
		if r.URL.Path != "/v1/projects/my-project-1/locations/us-east5/publishers/anthropic/models/claude-sonnet-5-5:rawPredict" {
			t.Errorf("path %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer vertex-token" {
			t.Errorf("authorization %q", r.Header.Get("Authorization"))
		}
		if body := readJSON(t, r); body["anthropic_version"] != vertexAnthropicBody || body["model"] != nil {
			t.Errorf("vertex body: %v", body)
		}
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"OK"}]}`)
	}))
	defer server.Close()
	account, _ := json.Marshal(map[string]string{
		"type": "service_account", "client_email": "ai@my-project-1.iam.gserviceaccount.com", "token_uri": server.URL + "/token",
		"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
	})
	model, err := NewModel(&Provider{Kind: KindVertex, Model: "claude-sonnet-5-5", Region: "us-east5", CloudProject: "my-project-1", BaseURL: server.URL},
		&Credential{ServiceAccountJSON: string(account)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := model.Chat(context.Background(), &ChatRequest{MaxTokens: 8, Turns: []Turn{{Role: "user", Text: "hi"}}})
	if err != nil || answer.Text != "OK" || tokens != 1 {
		t.Fatalf("answer=%+v err=%v tokens=%d", answer, err, tokens)
	}
}

func TestOpenAIModel_ToolsAndTokenField(t *testing.T) {
	for _, kind := range []Kind{KindOpenAI, KindCustom} {
		t.Run(string(kind), func(t *testing.T) {
			var got map[string]any
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer "+canaryKey {
					t.Errorf("request %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
				}
				got = readJSON(t, r)
				_, _ = io.WriteString(w, `{"choices":[{"message":{"content":null,"tool_calls":[{"id":"c9","type":"function","function":{"name":"vaultix__warp__list","arguments":"not json"}}]}}]}`)
			}))
			defer server.Close()
			model, err := NewModel(&Provider{Kind: kind, APIStyle: "openai-chat", AuthType: "bearer", Model: "gpt-x", BaseURL: server.URL + "/v1"}, &Credential{APIKey: canaryKey}, nil)
			if err != nil {
				t.Fatal(err)
			}
			answer, err := model.Chat(context.Background(), chatWithTool())
			if err != nil {
				t.Fatal(err)
			}
			_, completion := got["max_completion_tokens"]
			_, legacy := got["max_tokens"]
			if completion != (kind == KindOpenAI) || legacy == (kind == KindOpenAI) {
				t.Fatalf("token field wrong for %s: %v", kind, got)
			}
			messages := got["messages"].([]any)
			last := messages[len(messages)-1].(map[string]any)
			if messages[0].(map[string]any)["role"] != "system" || last["role"] != "tool" || last["tool_call_id"] != "call_1" {
				t.Fatalf("messages wrong: %v", messages)
			}
			if len(answer.ToolCalls) != 1 || string(answer.ToolCalls[0].Arguments) != "{}" {
				t.Fatalf("invalid arguments must become {}: %+v", answer)
			}
		})
	}
}

func TestProviderFailure_NamesTheProblemWithoutTheCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	}))
	defer server.Close()
	model, _ := NewModel(&Provider{Kind: KindAnthropic, Model: "m", BaseURL: server.URL}, &Credential{APIKey: canaryKey}, nil)
	_, err := model.Chat(context.Background(), &ChatRequest{MaxTokens: 8, Turns: []Turn{{Role: "user", Text: "hi"}}})
	if err == nil || !strings.Contains(err.Error(), "refused the credential: invalid x-api-key") || strings.Contains(err.Error(), canaryKey) {
		t.Fatalf("error %v", err)
	}
}

func TestPost_RefusesRedirects(t *testing.T) {
	elsewhere := 0
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { elsewhere++ }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/v1/chat/completions", http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	model, _ := NewModel(&Provider{Kind: KindCustom, APIStyle: "openai-chat", AuthType: "bearer", Model: "m", BaseURL: server.URL}, &Credential{APIKey: canaryKey}, HTTPClient(5*time.Second))
	if _, err := model.Chat(context.Background(), &ChatRequest{MaxTokens: 8, Turns: []Turn{{Role: "user", Text: "hi"}}}); err == nil {
		t.Fatal("a redirect must not be followed")
	}
	if elsewhere != 0 {
		t.Fatal("the credential was replayed to the redirect target")
	}
}

func TestFromDocument_TrimsAndShapes(t *testing.T) {
	endpoint, style, model := "https://llm.example.test/v1/", "openai-chat", "m"
	doc := &spec.Connection{SchemaVersion: spec.ConnectionVersion, Name: "  Gateway ", Kind: "custom", Endpoint: &endpoint, APIStyle: &style,
		Auth: &spec.Auth{Type: "bearer"}, Models: spec.Models{Standard: model}}
	p, err := fromDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Gateway" || p.BaseURL != "https://llm.example.test/v1" || p.TimeoutSeconds != 60 || p.Headers == nil || p.AuthType != "bearer" {
		t.Fatalf("not shaped: %+v", p)
	}
	view := p.View()
	if view.Endpoint == nil || *view.Endpoint != p.BaseURL || view.Auth == nil || view.Region != nil {
		t.Fatalf("view %+v", view)
	}
	key := "  sk-pasted-with-spaces \n"
	if c := credentialFrom(&spec.Credential{APIKey: &key}); c.APIKey != "sk-pasted-with-spaces" {
		t.Fatalf("key not trimmed: %q", c.APIKey)
	}
	bad := &spec.Connection{SchemaVersion: spec.ConnectionVersion, Name: "B", Kind: "bedrock", Models: spec.Models{Standard: model}}
	if _, err := fromDocument(bad); err == nil || !strings.Contains(err.Error(), "region") {
		t.Fatalf("a bedrock connection without a region must name the field: %v", err)
	}
}

func TestNewModel_HuggingFaceAndCustomHeaders(t *testing.T) {
	var seen http.Header
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen, path = r.Header.Clone(), r.URL.Path
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer server.Close()
	ask := func(p *Provider, c *Credential) {
		t.Helper()
		model, err := NewModel(p, c, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := model.Chat(context.Background(), &ChatRequest{MaxTokens: 8, Turns: []Turn{{Role: "user", Text: "hi"}}}); err != nil {
			t.Fatal(err)
		}
	}
	ask(&Provider{Kind: KindHuggingFace, Model: "openai/gpt-oss-120b:fastest", BillTo: "my-org", BaseURL: server.URL + "/v1"}, &Credential{APIKey: canaryKey})
	if path != "/v1/chat/completions" || seen.Get("Authorization") != "Bearer "+canaryKey || seen.Get("X-HF-Bill-To") != "my-org" {
		t.Fatalf("hugging face: %s %v", path, seen)
	}
	ask(&Provider{Kind: KindHuggingFaceEndpoint, Model: "tgi", BaseURL: server.URL}, &Credential{APIKey: canaryKey})
	if path != "/v1/chat/completions" {
		t.Fatalf("a dedicated endpoint gets /v1 once: %s", path)
	}
	ask(&Provider{Kind: KindCustom, APIStyle: "openai-chat", AuthType: "header", AuthHeaderName: "x-gateway-key", BaseURL: server.URL + "/v1", Model: "m",
		Headers: []spec.Header{{Name: "x-team", Value: "platform"}}}, &Credential{APIKey: canaryKey})
	if seen.Get("X-Gateway-Key") != canaryKey || seen.Get("Authorization") != "" || seen.Get("X-Team") != "platform" {
		t.Fatalf("custom header auth: %v", seen)
	}
	ask(&Provider{Kind: KindCustom, APIStyle: "openai-chat", AuthType: "none", BaseURL: server.URL + "/v1", Model: "m"}, &Credential{})
	if seen.Get("Authorization") != "" {
		t.Fatal("a keyless connection sent a key")
	}
}
