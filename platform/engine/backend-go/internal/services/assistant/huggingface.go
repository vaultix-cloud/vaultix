package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
)

// Hugging Face helpers for the guided connection (docs/0126). They read who a token belongs to and
// which dedicated endpoints it can see, and keep nothing: the token is stored only when the
// administrator saves a connection.

const (
	HuggingFaceHub       = "https://huggingface.co"
	HuggingFaceEndpoints = "https://api.endpoints.huggingface.cloud"
	maxHuggingFaceItems  = 200
)

var namespacePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$`)

type HuggingFaceAccount struct {
	Name          string   `json:"name"`
	FullName      string   `json:"fullName"`
	Organizations []string `json:"organizations"`
	// InferenceAllowed is false when a fine-grained token lacks "Make calls to Inference
	// Providers"; nil when the token is not fine-grained and Hugging Face decides per request.
	InferenceAllowed *bool `json:"inferenceAllowed"`
}

type HuggingFaceEndpoint struct {
	Name  string `json:"name"`
	URL   string `json:"url"`
	Model string `json:"model"`
	State string `json:"state"`
}

func huggingFaceGet(ctx context.Context, client *http.Client, address, token string, into any) error {
	raw, err := send(ctx, client, http.MethodGet, address, nil, func(r *http.Request) error {
		r.Header.Set("Authorization", "Bearer "+token)
		return nil
	})
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return &ProviderError{Status: http.StatusBadGateway, Message: "Hugging Face answered in an unexpected format."}
	}
	return nil
}

// LookupHuggingFaceAccount checks a token with Hugging Face and names its account and organizations.
func LookupHuggingFaceAccount(ctx context.Context, client *http.Client, hub, token string) (*HuggingFaceAccount, error) {
	var who struct {
		Name     string `json:"name"`
		FullName string `json:"fullname"`
		Orgs     []struct {
			Name string `json:"name"`
		} `json:"orgs"`
		Auth struct {
			AccessToken struct {
				Role        string `json:"role"`
				FineGrained struct {
					Global []string `json:"global"`
				} `json:"fineGrained"`
			} `json:"accessToken"`
		} `json:"auth"`
	}
	if err := huggingFaceGet(ctx, client, strings.TrimRight(hub, "/")+"/api/whoami-v2", token, &who); err != nil {
		return nil, err
	}
	if who.Name == "" {
		return nil, &ProviderError{Status: http.StatusBadGateway, Message: "Hugging Face did not say who this token belongs to."}
	}
	account := &HuggingFaceAccount{Name: who.Name, FullName: who.FullName, Organizations: []string{}}
	for _, org := range who.Orgs {
		if org.Name != "" && len(account.Organizations) < maxHuggingFaceItems {
			account.Organizations = append(account.Organizations, org.Name)
		}
	}
	if who.Auth.AccessToken.Role == "fineGrained" {
		allowed := slices.Contains(who.Auth.AccessToken.FineGrained.Global, "inference.serverless.write")
		account.InferenceAllowed = &allowed
	}
	return account, nil
}

// ListHuggingFaceEndpoints lists the dedicated endpoints of an account or organization.
func ListHuggingFaceEndpoints(ctx context.Context, client *http.Client, api, token, namespace string) ([]HuggingFaceEndpoint, error) {
	if !namespacePattern.MatchString(namespace) {
		return nil, &ProviderError{Status: http.StatusBadRequest, Message: "Choose a Hugging Face account or organization."}
	}
	var listed struct {
		Items []struct {
			Name  string `json:"name"`
			Model struct {
				Repository string `json:"repository"`
			} `json:"model"`
			Status struct {
				State string `json:"state"`
				URL   string `json:"url"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := huggingFaceGet(ctx, client, strings.TrimRight(api, "/")+"/v2/endpoint/"+url.PathEscape(namespace), token, &listed); err != nil {
		return nil, err
	}
	endpoints := []HuggingFaceEndpoint{}
	for _, item := range listed.Items {
		if item.Name == "" || len(endpoints) == maxHuggingFaceItems {
			continue
		}
		endpoints = append(endpoints, HuggingFaceEndpoint{Name: item.Name, URL: item.Status.URL, Model: item.Model.Repository, State: item.Status.State})
	}
	return endpoints, nil
}
