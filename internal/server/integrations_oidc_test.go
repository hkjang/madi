package server

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func signedOIDCTestToken(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT", "kid": "madi-test-key"})
	payload, _ := json.Marshal(claims)
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func TestPostgresOIDCCodePKCENonceAndVerifiedIdentity(t *testing.T) {
	_, server := integrationTestServer(t)
	admin := newIntegrationTestClient(t, server.URL)
	admin.request("POST", "/api/v1/auth/login", map[string]any{"email": "admin@example.test", "password": "Integration-Test-Password-2026!"}, 200)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	var mu sync.Mutex
	var nonce, challenge string
	verified := true
	badNonce := false
	email := "sso@example.test"
	subject := "sso-subject-1"
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}, "token_endpoint_auth_methods_supported": []string{"client_secret_basic"}})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{"kty": "RSA", "kid": "madi-test-key", "use": "sig", "alg": "RS256", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}})
		case "/token":
			_ = r.ParseForm()
			id, secret, _ := r.BasicAuth()
			if id != "madi-client" || secret != "madi-client-secret" {
				t.Error("OIDC client authentication missing")
				http.Error(w, "invalid_client", 401)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") != "test-code" || base64.RawURLEncoding.EncodeToString(sum[:]) != challenge || r.Form.Get("redirect_uri") != server.URL+"/api/v1/auth/oidc/callback" {
				t.Error("OIDC code / PKCE / redirect validation failed")
				http.Error(w, "invalid_grant", 400)
				return
			}
			tokenNonce := nonce
			if badNonce {
				tokenNonce = "wrong-nonce"
			}
			idToken := signedOIDCTestToken(t, key, map[string]any{"iss": issuer, "sub": subject, "aud": "madi-client", "exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix(), "nonce": tokenNonce, "email": email, "email_verified": verified, "name": "SSO 사용자"})
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "provider-access-token", "token_type": "Bearer", "expires_in": 60, "id_token": idToken})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	issuer = provider.URL
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"site_url": server.URL, "oidc_enabled": true, "oidc_issuer": issuer, "oidc_client_id": "madi-client", "oidc_client_secret": "madi-client-secret", "oidc_auto_register": true}, 200)
	browser := newIntegrationTestClient(t, server.URL)
	browser.client.CheckRedirect = func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	start := func() string {
		t.Helper()
		response, err := browser.client.Get(server.URL + "/api/v1/auth/oidc/start")
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 302 {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("OIDC start: %d %s", response.StatusCode, body)
		}
		location, err := url.Parse(response.Header.Get("Location"))
		if err != nil {
			t.Fatal(err)
		}
		q := location.Query()
		if q.Get("code_challenge_method") != "S256" || q.Get("response_type") != "code" || !strings.Contains(q.Get("scope"), "openid") || len(q.Get("state")) < 32 || len(q.Get("nonce")) < 32 {
			t.Fatalf("OIDC authorization parameters: %v", q)
		}
		mu.Lock()
		nonce = q.Get("nonce")
		challenge = q.Get("code_challenge")
		mu.Unlock()
		return "/api/v1/auth/oidc/callback?" + url.Values{"state": {q.Get("state")}, "code": {"test-code"}}.Encode()
	}
	callback := start()
	otherBrowser := newIntegrationTestClient(t, server.URL)
	otherBrowser.request("GET", callback, nil, 400) // A stolen state cannot be used in another browser.
	browser.request("GET", callback, nil, 302)
	me := testJSONObject(t, browser.request("GET", "/api/v1/auth/me", nil, 200))
	if str(me, "email") != "sso@example.test" || str(me, "role") != "editor" {
		t.Fatalf("unexpected SSO user: %v", me)
	}
	browser.request("GET", callback, nil, 400) // Consumed state cannot be replayed.
	mu.Lock()
	badNonce = true
	mu.Unlock()
	browser.request("GET", start(), nil, 401)
	mu.Lock()
	badNonce = false
	verified = false
	email = "admin@example.test"
	subject = "attacker-subject"
	mu.Unlock()
	browser.request("GET", start(), nil, 403) // Unverified email cannot bind to an existing local administrator.
	mu.Lock()
	verified = true
	email = "unregistered@example.test"
	subject = "unregistered-subject"
	mu.Unlock()
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"oidc_auto_register": false}, 200)
	browser.request("GET", start(), nil, 403)
}
