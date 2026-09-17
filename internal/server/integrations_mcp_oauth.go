package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5"
)

// MCP over SSO: the MCP authorization specification (2025-06-18 and later) is
// OAuth 2.1, and this server is only the *resource server* in it. Keycloak
// signs people in and mints access tokens; madi publishes where Keycloak is
// (RFC 9728), points a refused client at that document from its 401, and
// checks that a presented token was issued by that Keycloak for this server.
// Nothing here issues tokens, registers clients, or turns a token into a
// session. Personal keys keep working unchanged: a token is a second way into
// /mcp for an account that already exists, never a way to create one.

const mcpOAuthResourcePath = "/mcp"

type mcpOAuthSettings struct {
	Enabled  bool
	Issuer   string
	Resource string
	// Audiences are the administrator's accepted aud/azp values. Keycloak 26
	// puts the client id in azp and only "account" in aud unless a mapper is
	// configured, so naming the MCP client id here works without a mapper.
	Audiences []string
	// Scopes are the ceiling for SSO subjects, already cut to the key scopes
	// the administrator allows. Empty means nothing is permitted.
	Scopes []string
}

// mcpOAuthConfig reads the flat settings keys madi uses (mcp_oauth_*), the
// same shape as oidc_* and allowed_key_scopes.
func mcpOAuthConfig(settings map[string]any) mcpOAuthSettings {
	cfg := mcpOAuthSettings{Enabled: settingBool(settings, "mcp_oauth_enabled") && settingBool(settings, "oidc_enabled"), Issuer: settingString(settings, "oidc_issuer"), Resource: mcpOAuthResource(settings), Audiences: strings.Fields(settingString(settings, "mcp_oauth_audience"))}
	allowed := settingStrings(settings, "allowed_key_scopes", keyScopes)
	for _, scope := range settingStrings(settings, "mcp_oauth_scopes", mcpOAuthDefaultScopes()) {
		if slices.Contains(keyScopes, scope) && slices.Contains(allowed, scope) && !slices.Contains(cfg.Scopes, scope) {
			cfg.Scopes = append(cfg.Scopes, scope)
		}
	}
	if cfg.Scopes == nil {
		cfg.Scopes = []string{}
	}
	return cfg
}

func mcpOAuthDefaultScopes() []string {
	return []string{"document:read", "search:read", "database:read"}
}

// active is the runtime switch: enabled by the administrator, with a Keycloak
// issuer to trust and a resource identifier to claim. Missing pieces make the
// feature behave as off; the refusal message names what is missing.
func (cfg mcpOAuthSettings) active() bool {
	return cfg.Enabled && cfg.Issuer != "" && cfg.Resource != ""
}

// mcpOAuthResource is the identifier this deployment claims for its MCP
// endpoint: what the metadata advertises and what a token's aud may name. It
// comes from configuration, never from the request's Host header.
func mcpOAuthResource(settings map[string]any) string {
	if resource := settingString(settings, "mcp_oauth_resource"); resource != "" {
		return resource
	}
	base := strings.TrimRight(settingString(settings, "site_url"), "/")
	if base == "" {
		return ""
	}
	return base + mcpOAuthResourcePath
}

// metadataURL is RFC 9728's well-known location for a resource with a path:
// origin + /.well-known/oauth-protected-resource + path.
func (cfg mcpOAuthSettings) metadataURL() string {
	u, err := url.Parse(cfg.Resource)
	if err != nil {
		return ""
	}
	return u.Scheme + "://" + u.Host + "/.well-known/oauth-protected-resource" + u.Path
}

func validateMCPOAuthSettings(cfg map[string]any) error {
	if _, ok := cfg["mcp_oauth_enabled"].(bool); !ok {
		return fmt.Errorf("mcp_oauth_enabled 값은 true/false여야 합니다")
	}
	if resource := str(cfg, "mcp_oauth_resource"); resource != "" {
		u, e := url.Parse(resource)
		if e != nil || u.Host == "" || !oneOf(u.Scheme, "http", "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(resource, " \t\r\n\"\\") {
			return fmt.Errorf("MCP 리소스 식별자는 인증정보·쿼리·프래그먼트 없는 HTTP(S) URL이어야 합니다")
		}
		if u.Path != mcpOAuthResourcePath && u.Path != "/api/v1"+mcpOAuthResourcePath {
			return fmt.Errorf("MCP 리소스 식별자는 /mcp 또는 /api/v1/mcp 경로로 끝나야 합니다")
		}
	}
	audience, ok := cfg["mcp_oauth_audience"].(string)
	if !ok {
		return fmt.Errorf("mcp_oauth_audience 값은 공백으로 구분한 문자열이어야 합니다")
	}
	entries := strings.Fields(audience)
	if len(entries) > 50 {
		return fmt.Errorf("MCP 허용 대상은 최대 50개입니다")
	}
	for _, entry := range entries {
		if len(entry) > 256 || strings.ContainsAny(entry, "\"\\") {
			return fmt.Errorf("MCP 허용 대상 값이 너무 길거나 따옴표를 포함합니다: %s", entry)
		}
		for _, r := range entry {
			if r < 0x21 || r > 0x7e {
				return fmt.Errorf("MCP 허용 대상은 공백 없는 ASCII 문자열이어야 합니다: %s", entry)
			}
		}
	}
	switch scopes := cfg["mcp_oauth_scopes"].(type) {
	case []string:
	case []any:
		for _, scope := range scopes {
			if _, ok := scope.(string); !ok {
				return fmt.Errorf("MCP SSO 범위는 문자열 배열이어야 합니다")
			}
		}
	default:
		return fmt.Errorf("MCP SSO 범위는 문자열 배열이어야 합니다")
	}
	for _, scope := range listStrings(cfg["mcp_oauth_scopes"]) {
		if !slices.Contains(keyScopes, scope) {
			return fmt.Errorf("지원하지 않는 MCP SSO 범위: %s", scope)
		}
	}
	if boolean(cfg, "mcp_oauth_enabled") {
		if !boolean(cfg, "oidc_enabled") || str(cfg, "oidc_issuer") == "" {
			return fmt.Errorf("MCP SSO(OAuth) 인증은 Keycloak OIDC 로그인이 켜져 있고 issuer URL이 있어야 켤 수 있습니다")
		}
		if len(mcpOAuthConfig(cfg).Scopes) == 0 {
			return fmt.Errorf("MCP SSO 범위를 API 키 허용 권한 안에서 하나 이상 선택하세요")
		}
	}
	return nil
}

// mcpOAuthError is a refusal the client should read: Message goes to the
// response, Reason and Cause go to the log so an operator can tell which
// check (signature, issuer, expiry, nbf, audience, account) failed.
type mcpOAuthError struct {
	Message string
	Reason  string
	Cause   error
}

func (e *mcpOAuthError) Error() string { return e.Message }
func (e *mcpOAuthError) Unwrap() error { return e.Cause }

// mcpOAuthDispatchKey marks a request the MCP handler dispatched into REST on
// behalf of an SSO subject. Only such requests and the MCP paths themselves
// accept a JWT bearer; REST, websocket and admin calls from outside never do.
type mcpOAuthDispatchKey struct{}

func mcpPath(r *http.Request) bool {
	return r.URL.Path == mcpOAuthResourcePath || r.URL.Path == "/api/v1"+mcpOAuthResourcePath
}

func mcpOAuthEligible(r *http.Request) bool {
	dispatched, _ := r.Context().Value(mcpOAuthDispatchKey{}).(bool)
	return dispatched || mcpPath(r)
}

// looksLikeJWT separates "not a key" from "not any credential we accept" so
// the refusal can say which without a network round trip.
func looksLikeJWT(token string) bool {
	parts := strings.Split(token, ".")
	return len(parts) == 3 && parts[0] != "" && parts[1] != "" && parts[2] != ""
}

// mcpOAuthProviderCache keeps one discovered provider per issuer. Discovery
// and the JWKS behind it are network round trips to Keycloak; doing them per
// request would put Keycloak's latency in front of every MCP call. go-oidc
// refetches the key set on an unknown key id, so rotation needs no
// invalidation here, and the short lifetime picks up an issuer change.
type mcpOAuthProviderCache struct {
	mu       sync.Mutex
	issuer   string
	provider *oidc.Provider
	expires  time.Time
}

// mcpOAuthTransport bounds what discovery and key fetches may do: no
// redirects (set on the client), at most 1MB of body, and at most one JWKS
// refetch per second so a stream of forged tokens with random key ids cannot
// turn this server into a request generator against Keycloak.
type mcpOAuthTransport struct {
	base        http.RoundTripper
	discovery   string
	mu          sync.Mutex
	nextRefresh time.Time
}

func (t *mcpOAuthTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.String() != t.discovery {
		t.mu.Lock()
		delay := time.Until(t.nextRefresh)
		if delay < 0 {
			delay = 0
		}
		t.nextRefresh = time.Now().Add(delay + time.Second)
		t.mu.Unlock()
		if delay > 0 {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-r.Context().Done():
				return nil, r.Context().Err()
			case <-timer.C:
			}
		}
	}
	response, err := t.base.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	response.Body.Close()
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("OAuth metadata too large")
	}
	response.Body = io.NopCloser(bytes.NewReader(raw))
	return response, nil
}

func (s *Server) mcpOAuthProvider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	c := &s.mcpOAuth
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.issuer == issuer && time.Now().Before(c.expires) {
		if c.provider == nil {
			return nil, errors.New("recent discovery failure")
		}
		return c.provider, nil
	}
	client := &http.Client{Timeout: 10 * time.Second, Transport: &mcpOAuthTransport{base: http.DefaultTransport, discovery: strings.TrimSuffix(issuer, "/") + "/.well-known/openid-configuration"}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	// The provider outlives this request: go-oidc keeps the client for later
	// key fetches, so it must not be tied to a request context.
	provider, err := oidc.NewProvider(oidc.ClientContext(context.WithoutCancel(ctx), client), issuer)
	if err == nil {
		// Keys come from the issuer's own origin only, whatever discovery says.
		var metadata struct {
			JWKSURI string `json:"jwks_uri"`
		}
		source, _ := url.Parse(issuer)
		if provider.Claims(&metadata) != nil || metadata.JWKSURI == "" {
			err = errors.New("discovery document has no jwks_uri")
		} else if keys, parseErr := url.Parse(metadata.JWKSURI); parseErr != nil || source == nil || keys.Scheme != source.Scheme || keys.Host != source.Host {
			err = errors.New("jwks_uri is not on the issuer's origin")
		}
	}
	c.issuer = issuer
	c.provider = provider
	c.expires = time.Now().Add(5 * time.Minute)
	if err != nil {
		c.provider = nil
		c.expires = time.Now().Add(5 * time.Second)
		return nil, err
	}
	return provider, nil
}

var mcpOAuthSigningAlgorithms = []string{oidc.RS256, oidc.RS384, oidc.RS512, oidc.ES256, oidc.ES384, oidc.ES512, oidc.PS256, oidc.PS384, oidc.PS512}

// mcpOAuthPrincipal turns a Keycloak access token into the principal the
// linked account would have with a key carrying the administrator's SSO
// scopes, or says exactly why it will not. It never creates, re-enables or
// promotes an account: the token's roles are not consulted.
func (s *Server) mcpOAuthPrincipal(r *http.Request, settings map[string]any, token string) (*Principal, time.Time, error) {
	refuse := func(reason, message string, cause error) (*Principal, time.Time, error) {
		return nil, time.Time{}, &mcpOAuthError{Message: message, Reason: reason, Cause: cause}
	}
	cfg := mcpOAuthConfig(settings)
	if !cfg.Enabled {
		return refuse("disabled", "이 서버의 MCP는 SSO 액세스 토큰을 받지 않습니다. 개인 API 키(madi_)를 사용하거나 관리자가 MCP SSO(OAuth) 인증을 켜야 합니다.", nil)
	}
	if !cfg.active() {
		return refuse("unconfigured", "MCP SSO 인증이 켜져 있지만 Keycloak issuer 또는 서비스 URL 설정이 비어 있습니다. 관리자에게 알리세요.", nil)
	}
	if len(token) > 16384 {
		return refuse("token too large", "SSO 액세스 토큰이 너무 큽니다.", nil)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	provider, err := s.mcpOAuthProvider(ctx, cfg.Issuer)
	if err != nil {
		return refuse("discovery failed", "Keycloak 발급자 정보를 읽지 못해 SSO 토큰을 확인할 수 없습니다. 잠시 후 다시 시도하거나 관리자에게 알리세요.", err)
	}
	// Signature, issuer, exp and nbf. The audience is checked by hand below
	// because more than one value is acceptable and go-oidc compares one.
	verified, err := provider.VerifierContext(ctx, &oidc.Config{SkipClientIDCheck: true, SupportedSigningAlgs: mcpOAuthSigningAlgorithms}).Verify(ctx, token)
	if err != nil {
		return refuse("token rejected", "SSO 액세스 토큰이 유효하지 않습니다(서명·발급자·만료·nbf). 클라이언트에서 다시 로그인하세요.", err)
	}
	var claims struct {
		Type         string          `json:"typ"`
		ClientID     string          `json:"azp"`
		Scope        string          `json:"scope"`
		Confirmation json.RawMessage `json:"cnf"`
	}
	if err := verified.Claims(&claims); err != nil {
		return refuse("claims unreadable", "SSO 토큰의 내용을 읽을 수 없습니다.", err)
	}
	// An ID token proves a sign-in to the client; it is not an API credential.
	// A token bound by cnf (DPoP, mTLS) cannot be verified as a plain bearer.
	if claims.Type != "" && !strings.EqualFold(claims.Type, "Bearer") {
		return refuse("typ "+claims.Type, fmt.Sprintf("typ=%s 토큰은 MCP 자격이 아닙니다. Keycloak 액세스 토큰(typ=Bearer)을 보내세요.", claims.Type), nil)
	}
	if len(claims.Confirmation) > 0 && string(claims.Confirmation) != "null" {
		return refuse("cnf bound", "소지자 증명(cnf)이 묶인 토큰은 이 서버가 검증할 수 없어 받지 않습니다.", nil)
	}
	if strings.TrimSpace(verified.Subject) == "" {
		return refuse("no subject", "SSO 토큰에 사용자 식별자(sub)가 없습니다.", nil)
	}
	// Whom the token was minted for: aud names this resource, or aud/azp is a
	// client the administrator trusts. Anything else is a token for another
	// application in the realm, however valid its signature.
	accepted := append([]string{cfg.Resource}, cfg.Audiences...)
	bound := append(slices.Clone(verified.Audience), claims.ClientID)
	if !slices.ContainsFunc(bound, func(value string) bool { return value != "" && slices.Contains(accepted, value) }) {
		fix := claims.ClientID
		if fix == "" {
			fix = "<MCP 클라이언트 ID>"
		}
		return refuse(fmt.Sprintf("audience aud=%v azp=%q not accepted", verified.Audience, claims.ClientID), fmt.Sprintf("SSO 토큰이 이 서버를 위해 발급된 것이 아닙니다(aud=%v, azp=%q). 관리자가 허용 대상(mcp_oauth_audience)에 %s 를 적거나, Keycloak 클라이언트의 Audience 매퍼에 %q 를 넣으세요.", verified.Audience, claims.ClientID, fix, cfg.Resource), nil)
	}
	// The ceiling is the administrator's, never the token's roles. When the
	// token does carry madi's own scope vocabulary the subject gets only the
	// intersection; an empty intersection is a refusal, never an empty list
	// that some check might read as "unrestricted".
	if len(cfg.Scopes) == 0 {
		return refuse("no scopes configured", "관리자 설정 mcp_oauth_scopes 에 API 키 허용 권한 안의 범위가 없어 SSO 토큰으로 할 수 있는 일이 없습니다.", nil)
	}
	scopes := cfg.Scopes
	if carried := slices.DeleteFunc(strings.Fields(claims.Scope), func(scope string) bool { return !slices.Contains(keyScopes, scope) }); len(carried) > 0 {
		scopes = slices.DeleteFunc(slices.Clone(cfg.Scopes), func(scope string) bool { return !slices.Contains(carried, scope) })
		if len(scopes) == 0 {
			return refuse(fmt.Sprintf("scope %v outside ceiling %v", carried, cfg.Scopes), fmt.Sprintf("토큰의 scope %v 가 관리자가 허용한 MCP SSO 범위 %v 와 겹치지 않습니다.", carried, cfg.Scopes), nil)
		}
	}
	// The same link the web sign-in created, without the provisioning half.
	p := &Principal{Scopes: scopes, ScopeRestricted: true, OAuthSubject: verified.Subject}
	var disabled bool
	err = s.DB.QueryRow(ctx, `SELECT u.id::text,u.email,u.name,u.role,u.kind,u.disabled FROM identity_links l JOIN users u ON u.id=l.user_id WHERE l.provider='oidc' AND l.issuer=$1 AND l.subject=$2`, cfg.Issuer, verified.Subject).Scan(&p.ID, &p.Email, &p.Name, &p.Role, &p.Kind, &disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return refuse("account not linked", "이 SSO 계정은 madi에 등록되지 않았습니다. 먼저 웹으로 한 번 로그인하세요.", nil)
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	if disabled || p.Kind != "user" {
		return refuse("account inactive", "이 SSO 계정에 연결된 madi 사용자가 비활성 상태입니다. 관리자에게 문의하세요.", nil)
	}
	return p, verified.Expiry, nil
}

// mcpChallenge turns a 401 on an MCP path into an invitation: the client
// reads resource_metadata and starts the OAuth flow from there. REST 401s
// never carry it, so browsers and other clients are not sent to Keycloak.
func (s *Server) mcpChallenge(w http.ResponseWriter, r *http.Request, invalidToken bool) {
	if !mcpPath(r) {
		return
	}
	settings, err := s.settings(r.Context())
	if err != nil {
		return
	}
	cfg := mcpOAuthConfig(settings)
	if !cfg.active() {
		return
	}
	value := fmt.Sprintf(`Bearer realm="madi", resource_metadata=%q`, cfg.metadataURL())
	if invalidToken {
		value += `, error="invalid_token"`
	}
	w.Header().Set("WWW-Authenticate", value)
}

// mcpProtectedResource is RFC 9728: the document a refused MCP client reads
// to find the authorization server. Public by design and served bare, not in
// the product's envelope — the reader is an OAuth client library.
func (s *Server) mcpProtectedResource(w http.ResponseWriter, r *http.Request) {
	settings, err := s.settings(r.Context())
	if err != nil {
		apiError(w, 500, "설정을 불러올 수 없습니다.")
		return
	}
	cfg := mcpOAuthConfig(settings)
	if !cfg.active() {
		apiError(w, 404, "이 서버의 MCP는 SSO 토큰을 받지 않습니다. 개인 API 키를 사용하세요.")
		return
	}
	if suffix := r.PathValue("path"); suffix != "" {
		if u, err := url.Parse(cfg.Resource); err != nil || "/"+suffix != u.Path {
			apiError(w, 404, "경로를 찾을 수 없습니다")
			return
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=300")
	jsonResponse(w, 200, map[string]any{"resource": cfg.Resource, "authorization_servers": []string{cfg.Issuer}, "bearer_methods_supported": []string{"header"}, "scopes_supported": cfg.Scopes, "resource_name": settingString(settings, "site_name") + " MCP"})
}

func (s *Server) registerMCPOAuth() {
	s.mux.HandleFunc("GET /.well-known/oauth-protected-resource", s.mcpProtectedResource)
	s.mux.HandleFunc("GET /.well-known/oauth-protected-resource/{path...}", s.mcpProtectedResource)
}
