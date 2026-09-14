package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHandoffOriginAndSettingsValidation(t *testing.T) {
	for raw, want := range map[string]string{"https://Muni.intra": "https://muni.intra", "http://ptium.intra:8080/": "http://ptium.intra:8080", " https://weekly.intra ": "https://weekly.intra"} {
		if got, ok := handoffOrigin(raw); !ok || got != want {
			t.Fatalf("%q: got %q %v want %q", raw, got, ok, want)
		}
	}
	for _, raw := range []string{"", "muni.intra", "ftp://muni.intra", "https://user@muni.intra", "https://muni.intra/handoff", "https://muni.intra?x=1", "https://muni.intra#f", "javascript:alert(1)"} {
		if _, ok := handoffOrigin(raw); ok {
			t.Fatalf("%q must be rejected", raw)
		}
	}
	cfg := defaultSettings()
	if err := validateHandoffSettings(cfg); err != nil {
		t.Fatalf("empty default allow list must validate: %v", err)
	}
	if len(handoffPeers(cfg)) != 0 {
		t.Fatal("default allow list must be empty")
	}
	for _, bad := range []any{
		"https://muni.intra",
		[]any{"https://muni.intra"},
		[]any{map[string]any{"service": "slack", "origin": "https://muni.intra"}},
		[]any{map[string]any{"service": "muni", "origin": "https://muni.intra/path"}},
		[]any{map[string]any{"service": "muni", "origin": "https://muni.intra"}, map[string]any{"service": "ptium", "origin": "HTTPS://muni.intra/"}},
	} {
		cfg["handoff_allowed_origins"] = bad
		if validateHandoffSettings(cfg) == nil {
			t.Fatalf("%v must be rejected", bad)
		}
	}
	cfg["handoff_allowed_origins"] = []any{map[string]any{"service": "muni", "origin": "https://Muni.intra/"}, map[string]any{"service": "kanpic", "origin": "https://kanpic.intra"}}
	if err := validateHandoffSettings(cfg); err != nil {
		t.Fatal(err)
	}
	peers := handoffPeers(cfg)
	if len(peers) != 2 || peers[0].Origin != "https://muni.intra" || peers[0].Service != "muni" {
		t.Fatalf("peers: %+v", peers)
	}
	if got := handoffFilename(" 2026년 3분기/개편안: v2 "); got != "2026년 3분기 개편안  v2.md" {
		t.Fatalf("filename: %q", got)
	}
	if got := handoffFilename("../"); got != "문서.md" {
		t.Fatalf("filename fallback: %q", got)
	}
}

func TestHandoffFetchRefusesRedirectsOversizeAndWrongType(t *testing.T) {
	var hits atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if !strings.HasPrefix(r.URL.Path, "/api/v1/handoff/claims/") {
			http.NotFound(w, r)
			return
		}
		switch strings.TrimPrefix(r.URL.Path, "/api/v1/handoff/claims/") {
		case "redirect":
			http.Redirect(w, r, "http://127.0.0.1:1/internal", http.StatusFound)
		case "big":
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			w.Write([]byte(strings.Repeat("a", handoffMaxBytes+1)))
		case "html":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte("<h1>x</h1>"))
		case "gone":
			http.Error(w, "{}", 404)
		case "ok":
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape("2026년 3분기 개편안.md"))
			w.Write([]byte("# 개편안\n"))
		}
	}))
	defer peer.Close()
	client := (&Server{}).handoffClient()
	for claim, want := range map[string]string{"redirect": "리다이렉트", "big": "너무 큽니다", "html": "형식", "gone": "만료"} {
		if _, _, err := handoffFetch(context.Background(), client, peer.URL, claim); err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("%s: got %v want %q", claim, err, want)
		}
	}
	title, body, err := handoffFetch(context.Background(), client, peer.URL, "ok")
	if err != nil || title != "2026년 3분기 개편안" || body != "# 개편안\n" {
		t.Fatalf("ok: %q %q %v", title, body, err)
	}
	if hits.Load() != 5 {
		t.Fatalf("each fetch must hit the peer exactly once: %d", hits.Load())
	}
}

func TestPostgresHandoffClaimsAndReceive(t *testing.T) {
	s, server := integrationTestServer(t)
	admin := newIntegrationTestClient(t, server.URL)
	admin.request("POST", "/api/v1/auth/login", map[string]any{"email": "admin@example.test", "password": "Integration-Test-Password-2026!"}, 200)
	var workspaces []map[string]any
	json.Unmarshal(admin.request("GET", "/api/v1/workspaces", nil, 200), &workspaces)
	wid := str(workspaces[0], "id")
	admin.request("POST", "/api/v1/admin/users", map[string]any{"email": "other@example.test", "name": "다른 사용자", "password": "Other-test-password!", "role": "editor"}, 200)
	admin.request("PUT", "/api/v1/workspaces/"+wid+"/members", map[string]any{"email": "other@example.test", "role": "editor"}, 200)
	other := newIntegrationTestClient(t, server.URL)
	other.request("POST", "/api/v1/auth/login", map[string]any{"email": "other@example.test", "password": "Other-test-password!"}, 200)
	doc := testJSONObject(t, admin.request("POST", "/api/v1/documents", map[string]any{"workspace_id": wid, "title": "3분기 개편안", "markdown": "# 개편안\n\nHANDOFF_BODY\n", "visibility": "private"}, 200))
	did := str(doc, "id")

	// Default installation: no targets, no send button, no accepted source.
	if body := string(admin.request("GET", "/api/v1/handoff/targets", nil, 200)); strings.TrimSpace(body) != "[]" {
		t.Fatalf("targets must be empty by default: %s", body)
	}
	admin.request("POST", "/api/v1/handoff/claims", map[string]any{"resource": did, "format": "docx"}, 400)
	other.request("POST", "/api/v1/handoff/claims", map[string]any{"resource": did, "format": "markdown"}, 404)
	claim := testJSONObject(t, admin.request("POST", "/api/v1/handoff/claims", map[string]any{"resource": did, "format": "markdown"}, 201))
	if str(claim, "filename") != "3분기 개편안.md" || str(claim, "content_type") != handoffMIME || number(claim, "bytes", 0) != len("# 개편안\n\nHANDOFF_BODY\n") || str(claim, "source") != "http://localhost:8080" {
		t.Fatalf("claim: %v", claim)
	}
	if expires, err := time.Parse(time.RFC3339, str(claim, "expires_at")); err != nil || time.Until(expires) > handoffClaimTTL {
		t.Fatalf("expires_at: %v %v", claim["expires_at"], err)
	}
	var stored int
	if err := s.DB.QueryRow(context.Background(), "SELECT count(*) FROM handoff_claims WHERE claim_hash=$1", str(claim, "claim")).Scan(&stored); err != nil || stored != 0 {
		t.Fatal("the raw claim must never be stored")
	}
	anonymous := newIntegrationTestClient(t, server.URL)
	res, err := anonymous.client.Get(server.URL + "/api/v1/handoff/claims/" + str(claim, "claim"))
	if err != nil {
		t.Fatal(err)
	}
	body := readTestBody(t, res)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != handoffMIME || !strings.Contains(res.Header.Get("Content-Disposition"), "filename*=UTF-8''") || body != "# 개편안\n\nHANDOFF_BODY\n" {
		t.Fatalf("redeem: %d %v %q", res.StatusCode, res.Header, body)
	}
	anonymous.request("GET", "/api/v1/handoff/claims/"+str(claim, "claim"), nil, 404)
	expired := testJSONObject(t, admin.request("POST", "/api/v1/handoff/claims", map[string]any{"resource": did, "format": "markdown"}, 201))
	if _, err = s.DB.Exec(context.Background(), "UPDATE handoff_claims SET expires_at=now()-interval '1 second' WHERE claim_hash=$1", digest(str(expired, "claim"))); err != nil {
		t.Fatal(err)
	}
	anonymous.request("GET", "/api/v1/handoff/claims/"+str(expired, "claim"), nil, 404)
	anonymous.request("GET", "/api/v1/handoff/claims/not-a-claim-at-all-0123456789abcdef", nil, 404)

	// Receiving: a source outside the allow list is refused without a request.
	var peerHits atomic.Int32
	stranger := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { peerHits.Add(1) }))
	defer stranger.Close()
	fresh := testJSONObject(t, admin.request("POST", "/api/v1/handoff/claims", map[string]any{"resource": did, "format": "markdown"}, 201))
	receive := func(c *integrationTestClient, source, claim string, want int) *http.Response {
		t.Helper()
		c.client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		res, err := c.client.Get(server.URL + "/handoff?source=" + url.QueryEscape(source) + "&claim=" + url.QueryEscape(claim))
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != want {
			t.Fatalf("/handoff from %s: got %d want %d: %s", source, res.StatusCode, want, readTestBody(t, res))
		}
		return res
	}
	receive(anonymous, server.URL, str(fresh, "claim"), 401)
	receive(other, stranger.URL, str(fresh, "claim"), 403)
	receive(other, server.URL, str(fresh, "claim"), 403)
	if peerHits.Load() != 0 {
		t.Fatal("a source outside the allow list must not be contacted")
	}
	settings := testJSONObject(t, admin.request("GET", "/api/v1/admin/settings", nil, 200))
	if _, ok := settings["handoff_allowed_origins"].([]any); !ok {
		t.Fatalf("allow list must be exposed to the admin: %v", settings["handoff_allowed_origins"])
	}
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"handoff_allowed_origins": []any{map[string]any{"service": "kanpic", "origin": "https://kanpic.intra"}, map[string]any{"service": "muni", "origin": "https://muni.intra"}, map[string]any{"service": "madi", "origin": server.URL}}, "site_url": server.URL}, 200)
	var targets []handoffPeer
	json.Unmarshal(admin.request("GET", "/api/v1/handoff/targets", nil, 200), &targets)
	if len(targets) != 2 || targets[0].Service != "madi" || targets[1].Service != "muni" {
		t.Fatalf("only Markdown-accepting peers are targets: %+v", targets)
	}
	res = receive(other, server.URL, str(fresh, "claim"), 302)
	location := res.Header.Get("Location")
	if !strings.HasPrefix(location, "/app/documents/") {
		t.Fatalf("location: %q", location)
	}
	receivedID := strings.TrimPrefix(location, "/app/documents/")
	received := testJSONObject(t, other.request("GET", "/api/v1/documents/"+receivedID, nil, 200))
	if str(received, "title") != "3분기 개편안" || str(received, "markdown") != "# 개편안\n\nHANDOFF_BODY\n" || str(received, "visibility") != "private" {
		t.Fatalf("received document: %v", received)
	}
	var meta map[string]any
	var raw []byte
	if err = s.DB.QueryRow(context.Background(), "SELECT system_metadata FROM knowledge_document_meta WHERE document_id=$1 AND kind='inbox'", receivedID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(raw, &meta)
	if str(meta, "origin") != "handoff" || str(meta, "source") != strings.ToLower(server.URL) {
		t.Fatalf("origin must be recorded: %v", meta)
	}
	// The ticket was consumed by the receive; a replay shows the expired page.
	receive(other, server.URL, str(fresh, "claim"), 502)
}

func readTestBody(t *testing.T, res *http.Response) string {
	t.Helper()
	defer res.Body.Close()
	var b strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return b.String()
}
