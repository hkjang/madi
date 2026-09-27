package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func trackingTestPage(t *testing.T, client *integrationTestClient, path string) (string, http.Header) {
	t.Helper()
	response, err := client.client.Get(client.base + path)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 {
		t.Fatalf("GET %s: %d %s", path, response.StatusCode, body)
	}
	return string(body), response.Header
}

func TestPostgresTrackingSnippetAndPolicy(t *testing.T) {
	s, server := integrationTestServer(t)
	admin := newIntegrationTestClient(t, server.URL)
	admin.request("POST", "/api/v1/auth/login", map[string]any{"email": "admin@example.test", "password": "Integration-Test-Password-2026!"}, 200)
	settings := testJSONObject(t, admin.request("GET", "/api/v1/admin/settings", nil, 200))
	if enabled, ok := settings["tracking_enabled"].(bool); !ok || enabled || str(settings, "tracking_provider") != "none" {
		t.Fatalf("tracking must default to off: %v %v", settings["tracking_enabled"], settings["tracking_provider"])
	}

	// A fresh installation serves the page untouched under the strict policy.
	page, headers := trackingTestPage(t, admin, "/app")
	if strings.Contains(page, "<script") || headers.Get("Content-Security-Policy") != basePagePolicy {
		t.Fatalf("default page changed: %s %s", headers.Get("Content-Security-Policy"), page)
	}
	if _, api := trackingTestPage(t, admin, "/api/v1/public"); api.Get("Content-Security-Policy") != basePagePolicy {
		t.Fatalf("api policy: %s", api.Get("Content-Security-Policy"))
	}
	if _, health := trackingTestPage(t, admin, "/healthz"); health.Get("Content-Security-Policy") != serviceOnlyPolicy {
		t.Fatalf("service policy: %s", health.Get("Content-Security-Policy"))
	}
	if response, err := admin.client.Get(server.URL + "/momento/tracker.js"); err != nil || response.StatusCode != 404 {
		t.Fatalf("proxy must be closed while tracking is off: %v %v", err, response)
	}

	// A momento collector behind the same-origin proxy; it must never see the madi session cookie.
	var collectorHits atomic.Int32
	var sawCookie atomic.Bool
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		collectorHits.Add(1)
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			sawCookie.Store(true)
		}
		switch r.URL.Path {
		case "/base/tracker.js":
			w.Header().Set("Content-Type", "text/javascript")
			w.Header().Set("Set-Cookie", "collector=1")
			io.WriteString(w, "window.__momento='"+r.URL.RawQuery+"';")
		case "/base/collect/v1/events":
			body, _ := io.ReadAll(r.Body)
			if r.Method != http.MethodPost || !strings.Contains(string(body), "page_view") {
				w.WriteHeader(400)
				return
			}
			w.WriteHeader(204)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(collector.Close)

	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"tracking_enabled": true, "tracking_provider": "momento", "tracking_momento_url": collector.URL + "/base/", "tracking_momento_site_id": "madi-site"}, 200)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"tracking_custom_snippet": strings.Repeat("<script></script>", 600)}, 400)
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"tracking_enabled": "yes"}, 400)

	page, headers = trackingTestPage(t, admin, "/app")
	policy := headers.Get("Content-Security-Policy")
	nonce := ""
	if at := strings.Index(policy, "'nonce-"); at >= 0 {
		nonce = policy[at+len("'nonce-") : at+len("'nonce-")+strings.Index(policy[at+len("'nonce-"):], "'")]
	}
	if nonce == "" || !strings.Contains(page, `<script nonce="`+nonce+`" async src="/momento/tracker.js"`) || !strings.Contains(page, `data-endpoint="/momento"`) || !strings.Contains(page, `data-site-id="madi-site"`) {
		t.Fatalf("snippet with request nonce missing\npolicy: %s\npage: %s", policy, page)
	}
	if !strings.Contains(policy, "report-uri "+trackingReportPath) || strings.Contains(policy, "script-src 'self' 'unsafe-inline'") || strings.Contains(policy, collector.URL) {
		t.Fatalf("proxied momento policy must stay same-origin with a report-uri: %s", policy)
	}
	if _, again := trackingTestPage(t, admin, "/app"); strings.Contains(again.Get("Content-Security-Policy"), nonce) {
		t.Fatal("nonce must differ per request")
	}
	if adminPage, adminHeaders := trackingTestPage(t, admin, "/admin/settings"); strings.Contains(adminPage, "<script") || adminHeaders.Get("Content-Security-Policy") != basePagePolicy {
		t.Fatal("admin pages are excluded until include_admin is on")
	}
	if _, api := trackingTestPage(t, admin, "/api/v1/public"); api.Get("Content-Security-Policy") != basePagePolicy {
		t.Fatalf("api policy must not widen: %s", api.Get("Content-Security-Policy"))
	}
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"tracking_include_admin": true, "tracking_placement": "body"}, 200)
	if adminPage, _ := trackingTestPage(t, admin, "/admin/settings"); !strings.Contains(adminPage, "/momento/tracker.js") {
		t.Fatal("include_admin adds the snippet to admin pages")
	}

	// The proxy forwards script and events to the collector without the session cookie.
	script, scriptHeaders := trackingTestPage(t, admin, "/momento/tracker.js?v=1")
	if script != "window.__momento='v=1';" || scriptHeaders.Get("Set-Cookie") != "" {
		t.Fatalf("proxied tracker: %q %v", script, scriptHeaders)
	}
	events, err := admin.client.Post(server.URL+"/momento/collect/v1/events", "application/json", strings.NewReader(`{"events":[{"type":"page_view"}]}`))
	if err != nil || events.StatusCode != 204 {
		t.Fatalf("proxied events: %v %v", err, events)
	}
	events.Body.Close()
	if collectorHits.Load() != 2 || sawCookie.Load() {
		t.Fatalf("collector hits=%d cookie leaked=%v", collectorHits.Load(), sawCookie.Load())
	}

	// Browsers report what the policy refused; distinct origins are kept, repeats are counted.
	report := func(blocked, directive string) {
		t.Helper()
		body := `{"csp-report":{"blocked-uri":"` + blocked + `","effective-directive":"` + directive + `","document-uri":"` + server.URL + `/app/docs"}}`
		response, err := http.Post(server.URL+trackingReportPath, "application/csp-report", strings.NewReader(body))
		if err != nil || response.StatusCode != 204 {
			t.Fatalf("csp report: %v %v", err, response)
		}
		response.Body.Close()
	}
	report("https://cdn.vendor.example/loader.js", "script-src-elem")
	report("https://cdn.vendor.example/loader.js", "script-src-elem")
	report("https://beacon.vendor.example/collect", "connect-src")
	var listed struct{ Items []trackingViolation }
	if err := json.Unmarshal(admin.request("GET", "/api/v1/admin/tracking/violations", nil, 200), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Items) != 2 || listed.Items[0].Origin != "https://beacon.vendor.example" || listed.Items[1].Count != 2 || listed.Items[1].Page != "/app/docs" || listed.Items[0].Allowed {
		t.Fatalf("violations: %+v", listed.Items)
	}
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"tracking_allowed_hosts": "https://beacon.vendor.example"}, 200)
	if err := json.Unmarshal(admin.request("GET", "/api/v1/admin/tracking/violations", nil, 200), &listed); err != nil {
		t.Fatal(err)
	}
	if !listed.Items[0].Allowed || listed.Items[1].Allowed {
		t.Fatalf("allowed flag follows settings: %+v", listed.Items)
	}
	if _, headers := trackingTestPage(t, admin, "/app"); !strings.Contains(headers.Get("Content-Security-Policy"), "connect-src 'self' https://beacon.vendor.example") {
		t.Fatalf("allowed host reaches the policy: %s", headers.Get("Content-Security-Policy"))
	}
	viewer := newIntegrationTestClient(t, server.URL)
	viewer.request("GET", "/api/v1/admin/tracking/violations", nil, 401)
	admin.request("DELETE", "/api/v1/admin/tracking/violations", nil, 200)
	if err := json.Unmarshal(admin.request("GET", "/api/v1/admin/tracking/violations", nil, 200), &listed); err != nil || len(listed.Items) != 0 {
		t.Fatalf("forget: %v %+v", err, listed.Items)
	}

	// Turning tracking off restores the strict policy, closes the proxy and drops reports.
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"tracking_enabled": false}, 200)
	page, headers = trackingTestPage(t, admin, "/app")
	if strings.Contains(page, "<script") || headers.Get("Content-Security-Policy") != basePagePolicy {
		t.Fatalf("policy must return to strict: %s", headers.Get("Content-Security-Policy"))
	}
	if response, err := admin.client.Get(server.URL + "/momento/tracker.js"); err != nil || response.StatusCode != 404 {
		t.Fatalf("proxy must close with tracking: %v %v", err, response)
	}
	report("https://late.vendor.example/x.js", "script-src-elem")
	if err := json.Unmarshal(admin.request("GET", "/api/v1/admin/tracking/violations", nil, 200), &listed); err != nil || len(listed.Items) != 0 {
		t.Fatalf("reports are ignored while off: %v %+v", err, listed.Items)
	}
	if s.trackingViolations == nil {
		t.Fatal("recorder must exist")
	}
}
