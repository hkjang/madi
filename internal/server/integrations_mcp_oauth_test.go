package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMCPOAuthSettingsResourceAndValidation(t *testing.T) {
	base := defaultSettings()
	cfg := mcpOAuthConfig(base)
	if cfg.Enabled || cfg.active() || cfg.Resource != "http://localhost:8080/mcp" {
		t.Fatalf("default installation must be off with a site_url derived resource: %+v", cfg)
	}
	if got := cfg.metadataURL(); got != "http://localhost:8080/.well-known/oauth-protected-resource/mcp" {
		t.Fatalf("metadata URL: %s", got)
	}
	base["mcp_oauth_resource"] = "https://madi.example.internal/api/v1/mcp"
	if got := mcpOAuthConfig(base).metadataURL(); got != "https://madi.example.internal/.well-known/oauth-protected-resource/api/v1/mcp" {
		t.Fatalf("explicit resource metadata URL: %s", got)
	}
	// The ceiling never exceeds what keys may hold, and never comes back nil.
	base["mcp_oauth_scopes"] = []any{"document:write", "document:read", "bogus"}
	base["allowed_key_scopes"] = []any{"document:read"}
	if scopes := mcpOAuthConfig(base).Scopes; len(scopes) != 1 || scopes[0] != "document:read" {
		t.Fatalf("scope ceiling must be cut to allowed key scopes: %v", scopes)
	}
	base["allowed_key_scopes"] = []any{}
	if scopes := mcpOAuthConfig(base).Scopes; scopes == nil || len(scopes) != 0 {
		t.Fatalf("empty ceiling must be an empty list: %#v", scopes)
	}
	if validateMCPOAuthSettings(defaultSettings()) != nil {
		t.Fatal("defaults must validate")
	}
	cases := map[string]map[string]any{
		"enabled without oidc":     {"mcp_oauth_enabled": true},
		"enabled without issuer":   {"mcp_oauth_enabled": true, "oidc_enabled": true},
		"enabled with no scopes":   {"mcp_oauth_enabled": true, "oidc_enabled": true, "oidc_issuer": "https://sso.example/realms/x", "mcp_oauth_scopes": []any{}},
		"scope outside key scopes": {"mcp_oauth_enabled": true, "oidc_enabled": true, "oidc_issuer": "https://sso.example/realms/x", "mcp_oauth_scopes": []any{"document:write"}, "allowed_key_scopes": []any{"document:read"}},
		"resource with query":      {"mcp_oauth_resource": "https://madi.example/mcp?x=1"},
		"resource with userinfo":   {"mcp_oauth_resource": "https://user:pw@madi.example/mcp"},
		"resource wrong path":      {"mcp_oauth_resource": "https://madi.example/other"},
		"audience with quote":      {"mcp_oauth_audience": `claude "mcp`},
		"audience non ascii":       {"mcp_oauth_audience": "클로드"},
		"scopes not array":         {"mcp_oauth_scopes": "document:read"},
		"unknown scope":            {"mcp_oauth_scopes": []any{"identity:provision"}},
		"enabled not bool":         {"mcp_oauth_enabled": "true"},
	}
	for name, patch := range cases {
		cfg := defaultSettings()
		for k, v := range patch {
			cfg[k] = v
		}
		if validateMCPOAuthSettings(cfg) == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
	valid := defaultSettings()
	valid["mcp_oauth_enabled"], valid["oidc_enabled"], valid["oidc_issuer"] = true, true, "https://sso.example/realms/x"
	valid["mcp_oauth_resource"], valid["mcp_oauth_audience"] = "https://madi.example/mcp", "claude-mcp cursor-mcp"
	if err := validateMCPOAuthSettings(valid); err != nil {
		t.Fatalf("valid configuration rejected: %v", err)
	}
	for _, bad := range []string{"", "a.b", "a..c", ".b.c", "a.b.", "madi_x"} {
		if looksLikeJWT(bad) {
			t.Errorf("%q must not look like a JWT", bad)
		}
	}
	if !looksLikeJWT("eyJ.eyJ.sig") {
		t.Fatal("three non-empty segments are a JWT shape")
	}
	if mcpPath(httptest.NewRequest("POST", "/api/v1/documents", nil)) || !mcpPath(httptest.NewRequest("POST", "/mcp", nil)) || !mcpPath(httptest.NewRequest("POST", "/api/v1/mcp", nil)) {
		t.Fatal("MCP path detection")
	}
	dispatched := httptest.NewRequest("GET", "/api/v1/documents", nil)
	if mcpOAuthEligible(dispatched) || !mcpOAuthEligible(dispatched.WithContext(context.WithValue(dispatched.Context(), mcpOAuthDispatchKey{}, true))) {
		t.Fatal("only MCP paths and MCP-dispatched requests accept a JWT")
	}
}

type mcpOAuthLogBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *mcpOAuthLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *mcpOAuthLogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func hs256TestToken(claims map[string]any, secret string) string {
	header, _ := json.Marshal(map[string]any{"alg": "HS256", "typ": "JWT", "kid": "madi-test-key"})
	payload, _ := json.Marshal(claims)
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestPostgresMCPOAuthTokens(t *testing.T) {
	logs := &mcpOAuthLogBuffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	s, server := integrationTestServer(t)
	admin := newIntegrationTestClient(t, server.URL)
	admin.request("POST", "/api/v1/auth/login", map[string]any{"email": "admin@example.test", "password": "Integration-Test-Password-2026!"}, 200)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	wrongKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer string
	var mu sync.Mutex
	var nonce string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/jwks", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{"kty": "RSA", "kid": "madi-test-key", "use": "sig", "alg": "RS256", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}})
		case "/token":
			mu.Lock()
			defer mu.Unlock()
			idToken := signedOIDCTestToken(t, key, map[string]any{"iss": issuer, "sub": "sso-subject-1", "aud": "madi-web", "exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix(), "nonce": nonce, "email": "sso@example.test", "email_verified": true, "name": "SSO 사용자"})
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "provider-access-token", "token_type": "Bearer", "expires_in": 60, "id_token": idToken})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	issuer = provider.URL
	resource := server.URL + "/mcp"
	accessToken := func(patch map[string]any) string {
		claims := map[string]any{"iss": issuer, "sub": "sso-subject-1", "aud": []string{resource, "account"}, "azp": "claude-mcp", "typ": "Bearer", "exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Unix(), "scope": "openid profile email"}
		for k, v := range patch {
			if v == nil {
				delete(claims, k)
			} else {
				claims[k] = v
			}
		}
		return signedOIDCTestToken(t, key, claims)
	}
	raw := func(method, path, token string, body any) *http.Response {
		t.Helper()
		data, _ := json.Marshal(body)
		r, err := http.NewRequest(method, server.URL+path, bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	call := func(token string, request map[string]any) (int, string, http.Header) {
		t.Helper()
		response := raw("POST", "/mcp", token, request)
		defer response.Body.Close()
		out, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(out), response.Header
	}
	toolsList := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}

	// Off by default: no metadata, no challenge, and a token is refused with
	// the same words a bad key gets.
	for _, path := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		response := raw("GET", path, "", nil)
		response.Body.Close()
		if response.StatusCode != 404 {
			t.Fatalf("%s while disabled: %d", path, response.StatusCode)
		}
	}
	status, body, header := call(accessToken(nil), toolsList)
	if status != 401 || !strings.Contains(body, "API 키가 유효하지 않거나") || header.Get("WWW-Authenticate") != "" {
		t.Fatalf("disabled installation must refuse a token like a bad key: %d %s %q", status, body, header.Get("WWW-Authenticate"))
	}
	settings := testJSONObject(t, admin.request("GET", "/api/v1/admin/settings", nil, 200))
	if boolean(settings, "mcp_oauth_enabled") || str(settings, "mcp_oauth_resource") != "" || str(settings, "mcp_oauth_audience") != "" || len(listStrings(settings["mcp_oauth_scopes"])) != 3 {
		t.Fatalf("unexpected defaults: %v", settings)
	}
	public := testJSONObject(t, admin.request("GET", "/api/v1/public", nil, 200))
	if boolean(public, "mcp_oauth_enabled") || str(public, "mcp_oauth_resource") != "" {
		t.Fatalf("public info must not advertise SSO MCP while off: %v", public)
	}

	// Saving is refused until OIDC is configured, and with unusable values.
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_enabled": true}, 400)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"site_url": server.URL, "oidc_enabled": true, "oidc_issuer": issuer, "oidc_client_id": "madi-web", "oidc_client_secret": "madi-web-secret", "oidc_auto_register": true}, 200)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_enabled": true, "mcp_oauth_scopes": []string{}}, 400)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_enabled": true, "mcp_oauth_resource": "https://madi.example/other"}, 400)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_enabled": true, "mcp_oauth_audience": "bad\"quote"}, 400)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_enabled": true}, 200)

	// The metadata is bare JSON at both well-known paths, readable cross-origin.
	for _, path := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		response := raw("GET", path, "", nil)
		out, _ := io.ReadAll(response.Body)
		response.Body.Close()
		var metadata map[string]any
		if response.StatusCode != 200 || json.Unmarshal(out, &metadata) != nil || response.Header.Get("Access-Control-Allow-Origin") != "*" {
			t.Fatalf("%s: %d %s", path, response.StatusCode, out)
		}
		if str(metadata, "resource") != resource || len(listStrings(metadata["authorization_servers"])) != 1 || listStrings(metadata["authorization_servers"])[0] != issuer || listStrings(metadata["bearer_methods_supported"])[0] != "header" || len(listStrings(metadata["scopes_supported"])) != 3 || metadata["error"] != nil {
			t.Fatalf("%s metadata: %s", path, out)
		}
	}
	if response := raw("GET", "/.well-known/oauth-protected-resource/api/v1/mcp", "", nil); response.StatusCode != 404 {
		t.Fatalf("metadata for a path that is not the resource: %d", response.StatusCode)
	}
	public = testJSONObject(t, admin.request("GET", "/api/v1/public", nil, 200))
	if !boolean(public, "mcp_oauth_enabled") || str(public, "mcp_oauth_resource") != resource {
		t.Fatalf("public info must advertise the SSO MCP address: %v", public)
	}

	// A 401 on the MCP path points at the metadata; a REST 401 does not.
	wantChallenge := `Bearer realm="madi", resource_metadata="` + server.URL + `/.well-known/oauth-protected-resource/mcp"`
	status, _, header = call("", toolsList)
	if status != 401 || header.Get("WWW-Authenticate") != wantChallenge {
		t.Fatalf("challenge without a token: %d %q", status, header.Get("WWW-Authenticate"))
	}
	if response := raw("POST", "/api/v1/mcp", "", toolsList); response.StatusCode != 401 || response.Header.Get("WWW-Authenticate") != wantChallenge {
		t.Fatalf("challenge on /api/v1/mcp: %d %q", response.StatusCode, response.Header.Get("WWW-Authenticate"))
	}
	if response := raw("GET", "/api/v1/documents", "", nil); response.StatusCode != 401 || response.Header.Get("WWW-Authenticate") != "" {
		t.Fatalf("REST 401 must not carry the challenge: %d %q", response.StatusCode, response.Header.Get("WWW-Authenticate"))
	}

	// A valid token for a subject nobody has signed in with: refused, and no
	// account appears.
	var users int
	if err := s.DB.QueryRow(context.Background(), "SELECT count(*) FROM users").Scan(&users); err != nil {
		t.Fatal(err)
	}
	status, body, header = call(accessToken(nil), toolsList)
	if status != 401 || !strings.Contains(body, "먼저 웹으로") || header.Get("WWW-Authenticate") != wantChallenge+`, error="invalid_token"` {
		t.Fatalf("unlinked subject: %d %s %q", status, body, header.Get("WWW-Authenticate"))
	}
	var after int
	if err := s.DB.QueryRow(context.Background(), "SELECT count(*) FROM users").Scan(&after); err != nil || after != users {
		t.Fatalf("token presentation created an account: %d -> %d (%v)", users, after, err)
	}

	// Signing in on the web once is the registration.
	browser := newIntegrationTestClient(t, server.URL)
	browser.client.CheckRedirect = func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	response, err := browser.client.Get(server.URL + "/api/v1/auth/oidc/start")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	location, err := url.Parse(response.Header.Get("Location"))
	if err != nil || response.StatusCode != 302 {
		t.Fatalf("OIDC start: %d %v", response.StatusCode, err)
	}
	mu.Lock()
	nonce = location.Query().Get("nonce")
	mu.Unlock()
	browser.request("GET", "/api/v1/auth/oidc/callback?"+url.Values{"state": {location.Query().Get("state")}, "code": {"test-code"}}.Encode(), nil, 302)
	me := testJSONObject(t, browser.request("GET", "/api/v1/auth/me", nil, 200))
	ssoUserID := str(me, "id")
	var workspaces []map[string]any
	if err := json.Unmarshal(admin.request("GET", "/api/v1/workspaces", nil, 200), &workspaces); err != nil {
		t.Fatal(err)
	}
	wid := str(workspaces[0], "id")
	admin.request("PUT", "/api/v1/workspaces/"+wid+"/members", map[string]any{"email": "sso@example.test", "role": "editor"}, 0)
	visible := testJSONObject(t, admin.request("POST", "/api/v1/documents", map[string]any{"workspace_id": wid, "title": "SSO 지침", "markdown": "OAUTH_PUBLIC_MARK 공개 지침"}, 0))
	admin.request("POST", "/api/v1/documents", map[string]any{"workspace_id": wid, "title": "관리자 비공개", "markdown": "OAUTH_PRIVATE_MARK 비공개", "visibility": "private"}, 0)

	// The token now opens /mcp with the administrator's read-only ceiling.
	status, body, _ = call(accessToken(nil), map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{"protocolVersion": mcpVersions[0]}})
	if status != 200 || !strings.Contains(body, "workspace_id를 지정") {
		t.Fatalf("initialize over SSO: %d %s", status, body)
	}
	status, body, _ = call(accessToken(nil), toolsList)
	if status != 200 || !strings.Contains(body, `"search_documents"`) || !strings.Contains(body, `"list_databases"`) || strings.Contains(body, `"create_document"`) || strings.Contains(body, `"create_database_row"`) {
		t.Fatalf("SSO tools/list must hold the read ceiling: %d %s", status, body)
	}
	search := func(token string) string {
		t.Helper()
		status, body, _ := call(token, map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": map[string]any{"name": "search_documents", "arguments": map[string]any{"query": "지침", "workspace_id": wid}}})
		if status != 200 {
			t.Fatalf("search over SSO: %d %s", status, body)
		}
		return body
	}
	if body = search(accessToken(nil)); !strings.Contains(body, "OAUTH_PUBLIC_MARK") || strings.Contains(body, "OAUTH_PRIVATE_MARK") || strings.Contains(body, `"isError":true`) {
		t.Fatalf("SSO search must apply the linked user's ACL: %s", body)
	}
	status, body, _ = call(accessToken(nil), map[string]any{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": map[string]any{"name": "get_document", "arguments": map[string]any{"document_id": str(visible, "id")}}})
	if status != 200 || !strings.Contains(body, "OAUTH_PUBLIC_MARK") || strings.Contains(body, `"isError":true`) {
		t.Fatalf("SSO get_document: %d %s", status, body)
	}
	status, body, _ = call(accessToken(nil), map[string]any{"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": map[string]any{"name": "create_document", "arguments": map[string]any{"workspace_id": wid, "title": "SSO 쓰기", "markdown": "x"}}})
	if status != 200 || !strings.Contains(body, `"isError":true`) || !strings.Contains(body, "권한 범위") {
		t.Fatalf("write tool must stay closed under the read ceiling: %d %s", status, body)
	}
	var created int
	if err := s.DB.QueryRow(context.Background(), "SELECT count(*) FROM documents WHERE title='SSO 쓰기'").Scan(&created); err != nil || created != 0 {
		t.Fatalf("write happened through SSO: %d %v", created, err)
	}
	// The same token is not a REST, key-management or admin credential.
	for _, path := range []string{"/api/v1/documents?workspace_id=" + wid, "/api/v1/auth/me", "/api/v1/keys", "/api/v1/admin/settings"} {
		response := raw("GET", path, accessToken(nil), nil)
		out, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 401 || !strings.Contains(string(out), "API 키가 유효하지 않거나") || response.Header.Get("WWW-Authenticate") != "" {
			t.Fatalf("REST %s accepted or explained an SSO token: %d %s", path, response.StatusCode, out)
		}
	}

	// Audience: a token for another application in the realm is refused with
	// what was seen and what to configure; the administrator's list fixes it.
	status, body, header = call(accessToken(map[string]any{"aud": "account", "azp": "other-app"}), toolsList)
	if message := str(testJSONObject(t, []byte(body)), "error"); status != 401 || !strings.Contains(message, "aud=[account]") || !strings.Contains(message, `azp="other-app"`) || !strings.Contains(message, "other-app 를 적거나") || !strings.Contains(message, resource) || !strings.Contains(header.Get("WWW-Authenticate"), `error="invalid_token"`) {
		t.Fatalf("foreign audience refusal must be actionable: %d %s %q", status, body, header.Get("WWW-Authenticate"))
	}
	if logged := logs.String(); !strings.Contains(logged, "mcp oauth token refused") || !strings.Contains(logged, "audience aud=[account]") || !strings.Contains(logged, "other-app") {
		t.Fatalf("audience refusal reason must be logged: %s", logged)
	}
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_audience": "cursor-mcp other-app"}, 200)
	if body = search(accessToken(map[string]any{"aud": "account", "azp": "other-app"})); !strings.Contains(body, "OAUTH_PUBLIC_MARK") {
		t.Fatalf("azp in the administrator's list must pass without a mapper: %s", body)
	}
	if body = search(accessToken(map[string]any{"aud": "cursor-mcp", "azp": nil})); !strings.Contains(body, "OAUTH_PUBLIC_MARK") {
		t.Fatalf("aud in the administrator's list must pass: %s", body)
	}

	// Every other refusal, each one leaving its cause in the log.
	secret := "not-an-asymmetric-key"
	refusals := map[string]struct {
		token string
		want  string
		log   string
	}{
		"expired":        {accessToken(map[string]any{"exp": time.Now().Add(-time.Minute).Unix()}), "유효하지 않습니다", "expired"},
		"not yet valid":  {accessToken(map[string]any{"nbf": time.Now().Add(time.Hour).Unix()}), "유효하지 않습니다", "nbf"},
		"other issuer":   {accessToken(map[string]any{"iss": issuer + "/other"}), "유효하지 않습니다", "issued by a different provider"},
		"wrong key":      {signedOIDCTestToken(t, wrongKey, map[string]any{"iss": issuer, "sub": "sso-subject-1", "aud": resource, "typ": "Bearer", "exp": time.Now().Add(time.Minute).Unix()}), "유효하지 않습니다", "signature"},
		"hs256":          {hs256TestToken(map[string]any{"iss": issuer, "sub": "sso-subject-1", "aud": resource, "typ": "Bearer", "exp": time.Now().Add(time.Minute).Unix()}, secret), "유효하지 않습니다", "HS256"},
		"id token":       {accessToken(map[string]any{"typ": "ID"}), "typ=ID", "typ ID"},
		"cnf bound":      {accessToken(map[string]any{"cnf": map[string]any{"jkt": "thumbprint"}}), "cnf", "cnf bound"},
		"no subject":     {accessToken(map[string]any{"sub": ""}), "sub", "no subject"},
		"scope disjoint": {accessToken(map[string]any{"scope": "openid document:write"}), "겹치지 않습니다", "outside ceiling"},
	}
	for name, c := range refusals {
		status, body, header := call(c.token, toolsList)
		if status != 401 || !strings.Contains(body, c.want) || !strings.Contains(header.Get("WWW-Authenticate"), `error="invalid_token"`) {
			t.Errorf("%s: %d %s %q", name, status, body, header.Get("WWW-Authenticate"))
		}
		if !strings.Contains(logs.String(), c.log) {
			t.Errorf("%s: log must name the failed check %q", name, c.log)
		}
	}
	// A token carrying madi's own vocabulary gets the intersection only.
	status, body, _ = call(accessToken(map[string]any{"scope": "openid search:read document:write"}), toolsList)
	if status != 200 || !strings.Contains(body, `"search_documents"`) || strings.Contains(body, `"get_document"`) || strings.Contains(body, `"create_document"`) {
		t.Fatalf("scope intersection: %d %s", status, body)
	}
	// Saving a key policy that empties the ceiling is refused; a stored state
	// that predates that check (restored history) is an explicit runtime
	// refusal, never an empty list some check could read as "unrestricted".
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"allowed_key_scopes": []string{"ai:execute"}}, 400)
	if _, err := s.DB.Exec(context.Background(), `UPDATE settings SET data=jsonb_set(data,'{allowed_key_scopes}','["ai:execute"]') WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if status, body, _ = call(accessToken(nil), toolsList); status != 401 || !strings.Contains(body, "할 수 있는 일이 없습니다") {
		t.Fatalf("empty ceiling must refuse, never grant everything: %d %s", status, body)
	}
	if response := raw("GET", "/.well-known/oauth-protected-resource/mcp", "", nil); response.StatusCode != 200 {
		t.Fatalf("metadata with an empty ceiling: %d", response.StatusCode)
	}
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"allowed_key_scopes": keyScopes}, 200)

	// A disabled account does not come back through MCP.
	admin.request("PUT", "/api/v1/admin/users/"+ssoUserID, map[string]any{"disabled": true}, 200)
	if status, body, _ = call(accessToken(nil), toolsList); status != 401 || !strings.Contains(body, "비활성") {
		t.Fatalf("disabled account: %d %s", status, body)
	}
	admin.request("PUT", "/api/v1/admin/users/"+ssoUserID, map[string]any{"disabled": false}, 200)

	// Keys are untouched: a key still works on REST and MCP alike.
	issued := testJSONObject(t, admin.request("POST", "/api/v1/keys", map[string]any{"user_id": ssoUserID, "name": "키", "workspace_id": wid, "scopes": []string{"document:read", "search:read"}, "expires_in_days": 30, "rate_limit": 500}, 201))
	if body = search(str(issued, "token")); !strings.Contains(body, "OAUTH_PUBLIC_MARK") {
		t.Fatalf("key MCP search: %s", body)
	}
	if response := raw("GET", "/api/v1/documents/"+str(visible, "id"), str(issued, "token"), nil); response.StatusCode != 200 {
		t.Fatalf("key REST: %d", response.StatusCode)
	}
	if status, body, _ = call("not.a.key", toolsList); status != 401 || !strings.Contains(body, "유효하지 않습니다") {
		t.Fatalf("a JWT-shaped string that is not a JWT: %d %s", status, body)
	}

	// Off again: metadata disappears and tokens are plain bad keys.
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mcp_oauth_enabled": false}, 200)
	if response := raw("GET", "/.well-known/oauth-protected-resource/mcp", "", nil); response.StatusCode != 404 {
		t.Fatalf("metadata after disabling: %d", response.StatusCode)
	}
	if status, body, header = call(accessToken(nil), toolsList); status != 401 || !strings.Contains(body, "API 키가 유효하지 않거나") || header.Get("WWW-Authenticate") != "" {
		t.Fatalf("disabled again: %d %s %q", status, body, header.Get("WWW-Authenticate"))
	}
}
