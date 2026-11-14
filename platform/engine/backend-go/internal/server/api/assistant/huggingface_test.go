package assistant

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestHuggingFace_AccountAndEndpointsWithAPastedToken(t *testing.T) {
	const token = "hf_pasted_canary"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"error":"Invalid credentials in Authorization header"}`)
			return
		}
		switch r.URL.Path {
		case "/api/whoami-v2":
			_, _ = io.WriteString(w, `{"name":"jo","fullname":"Jo","orgs":[{"name":"acme"}],"auth":{"accessToken":{"role":"fineGrained","fineGrained":{"global":["inference.serverless.write"]}}}}`)
		case "/v2/endpoint/acme":
			_, _ = io.WriteString(w, `{"items":[{"name":"llama","model":{"repository":"meta-llama/Llama-3.1-8B-Instruct"},"status":{"state":"running","url":"https://x.endpoints.huggingface.cloud"}}]}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	deps := &Deps{Providers: &fakeProviders{}, Personas: fakePersonas{}, Memories: &fakeMemories{}, HuggingFaceHub: server.URL, HuggingFaceAPI: server.URL}

	recorder := serveWith(t, deps, personIdentity(true), http.MethodPost, Prefix+"/huggingface/account", `{"token":"  `+token+` "}`)
	var account struct {
		Account struct {
			Name             string
			Organizations    []string
			InferenceAllowed *bool
		}
	}
	_ = json.Unmarshal(recorder.Body.Bytes(), &account)
	if recorder.Code != http.StatusOK || account.Account.Name != "jo" || len(account.Account.Organizations) != 1 ||
		account.Account.InferenceAllowed == nil || !*account.Account.InferenceAllowed {
		t.Fatalf("account %d %s", recorder.Code, recorder.Body)
	}
	if strings.Contains(recorder.Body.String(), token) {
		t.Fatal("the token was returned")
	}

	recorder = serveWith(t, deps, personIdentity(true), http.MethodPost, Prefix+"/huggingface/endpoints", `{"token":"`+token+`","namespace":"acme"}`)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"url":"https://x.endpoints.huggingface.cloud"`) {
		t.Fatalf("endpoints %d %s", recorder.Code, recorder.Body)
	}

	recorder = serveWith(t, deps, personIdentity(true), http.MethodPost, Prefix+"/huggingface/account", `{"token":"hf_wrong"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a refused token is the administrator's to fix: %d %s", recorder.Code, recorder.Body)
	}
	recorder = serveWith(t, deps, personIdentity(true), http.MethodPost, Prefix+"/huggingface/endpoints", `{"token":"`+token+`","namespace":"../x"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a malformed namespace is refused before any request: %d", recorder.Code)
	}
	recorder = serveWith(t, deps, personIdentity(false), http.MethodPost, Prefix+"/huggingface/account", `{"token":"`+token+`"}`)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("only instance administrators: %d", recorder.Code)
	}
	recorder = serveWith(t, deps, personIdentity(true), http.MethodPost, Prefix+"/huggingface/account", `{"connectionId":"`+uuid.NewString()+`"}`)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a non-Hugging Face connection's key is never used: %d %s", recorder.Code, recorder.Body)
	}
}
