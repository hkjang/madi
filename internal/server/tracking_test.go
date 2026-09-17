package server

import (
	"strings"
	"testing"
	"time"
)

func trackingTestConfig(overrides map[string]any) map[string]any {
	cfg := defaultSettings()
	for key, value := range overrides {
		cfg[key] = value
	}
	return cfg
}

func TestTrackingDefaultsOffAndPolicyUnchanged(t *testing.T) {
	cfg := readTrackingConfig(defaultSettings())
	if cfg.Enabled || cfg.Provider != trackingProviderNone || cfg.active("/app") || cfg.proxyActive() {
		t.Fatalf("tracking must be off by default: %+v", cfg)
	}
	if err := validateTrackingSettings(defaultSettings()); err != nil {
		t.Fatal(err)
	}
	if got := cfg.policy("/app", "n"); got != basePagePolicy {
		t.Fatalf("default policy must stay strict: %s", got)
	}
	if page := cfg.inject([]byte("<html><head></head><body></body></html>"), "n"); strings.Contains(string(page), "<script") {
		t.Fatalf("no snippet when off: %s", page)
	}
	if strings.Contains(basePagePolicy, "'unsafe-inline'") && !strings.Contains(basePagePolicy, "style-src 'self' 'unsafe-inline'") {
		t.Fatal("unsafe-inline may only remain on style-src")
	}
}

func TestTrackingNonceOnEveryScriptWithLengthChangingRunes(t *testing.T) {
	// U+0130 folds to three bytes and U+212A to one; indexes from a lowered copy would land inside the tag.
	snippet := "İİİİ<script>1</script>K<SCRIPT src=\"https://t.example/a.js\"></SCRIPT><script nonce=\"keep\">2</script>"
	got := trackingWithNonce(snippet, "abc")
	want := "İİİİ<script nonce=\"abc\">1</script>K<SCRIPT nonce=\"abc\" src=\"https://t.example/a.js\"></SCRIPT><script nonce=\"keep\">2</script>"
	if got != want {
		t.Fatalf("nonce placement\n got: %s\nwant: %s", got, want)
	}
	if strings.Contains(got, "<sc nonce") {
		t.Fatal("nonce broke a tag name")
	}
}

func TestTrackingSnippetOriginsAndPolicySources(t *testing.T) {
	snippet := `<script async src="HTTPS://Momento.Corp.Example/tracker.js" data-site-id="s"></script><script>fetch('https://momento.corp.example/collect');new Image().src="http://pixel.example:8080/p.gif?x=1"</script>`
	origins := trackingSnippetOrigins(snippet)
	if len(origins) != 2 || origins[0] != "https://momento.corp.example" || origins[1] != "http://pixel.example:8080" {
		t.Fatalf("origins: %v", origins)
	}
	cfg := readTrackingConfig(trackingTestConfig(map[string]any{"tracking_enabled": true, "tracking_provider": "custom", "tracking_custom_snippet": snippet, "tracking_allowed_hosts": "https://extra.example, https://extra.example/\nhttps://second.example"}))
	scripts, connects, images := cfg.policySources()
	for _, group := range [][]string{scripts, connects, images} {
		joined := strings.Join(group, " ")
		for _, origin := range []string{"https://momento.corp.example", "http://pixel.example:8080", "https://extra.example", "https://second.example"} {
			if !strings.Contains(joined, origin) {
				t.Fatalf("missing %s in %s", origin, joined)
			}
		}
	}
	policy := cfg.policy("/app", "n0nce")
	if !strings.Contains(policy, "script-src 'self' 'nonce-n0nce' https://momento.corp.example") || !strings.Contains(policy, "report-uri "+trackingReportPath) {
		t.Fatalf("policy: %s", policy)
	}
	if strings.Contains(strings.TrimPrefix(policy, "default-src 'self'; script-src 'self' 'nonce-n0nce'"), "script-src") || strings.Contains(policy, "script-src 'self' 'unsafe-inline'") || strings.Contains(policy, "'unsafe-inline' https") {
		t.Fatalf("script-src must never carry unsafe-inline: %s", policy)
	}
}

func TestTrackingMomentoProxyKeepsPolicySameOrigin(t *testing.T) {
	base := map[string]any{"tracking_enabled": true, "tracking_provider": "momento", "tracking_momento_url": "https://momento.corp.example/", "tracking_momento_site_id": "madi-1"}
	cfg := readTrackingConfig(trackingTestConfig(base))
	if !cfg.proxyActive() {
		t.Fatal("proxy is the default momento path")
	}
	snippet := cfg.snippet("n")
	if !strings.Contains(snippet, `src="/momento/tracker.js"`) || !strings.Contains(snippet, `data-endpoint="/momento"`) || !strings.Contains(snippet, `nonce="n"`) || !strings.Contains(snippet, `data-site-id="madi-1"`) {
		t.Fatalf("momento snippet: %s", snippet)
	}
	if scripts, connects, _ := cfg.policySources(); len(scripts) != 0 || len(connects) != 0 {
		t.Fatalf("proxied momento must add no external origin: %v %v", scripts, connects)
	}
	base["tracking_momento_proxy"] = false
	direct := readTrackingConfig(trackingTestConfig(base))
	if direct.proxyActive() || !strings.Contains(direct.snippet("n"), `src="https://momento.corp.example/tracker.js"`) || strings.Contains(direct.snippet("n"), "data-endpoint") {
		t.Fatalf("direct momento snippet: %s", direct.snippet("n"))
	}
	if scripts, _, _ := direct.policySources(); len(scripts) != 1 || scripts[0] != "https://momento.corp.example" {
		t.Fatalf("direct momento origins: %v", scripts)
	}
}

func TestTrackingPlacementAndAdminExclusion(t *testing.T) {
	page := []byte("<!doctype html><HTML><HEAD><title>x</title></HEAD><BODY><div id=\"root\"></div></BODY></HTML>")
	cfg := readTrackingConfig(trackingTestConfig(map[string]any{"tracking_enabled": true, "tracking_provider": "ga4", "tracking_measurement_id": "G-1"}))
	head := string(cfg.inject(page, "n"))
	if !strings.Contains(head, "gtag('config','G-1');</script>\n</HEAD>") || strings.Count(head, `nonce="n"`) != 2 {
		t.Fatalf("head placement: %s", head)
	}
	cfg.Placement = "body"
	body := string(cfg.inject(page, "n"))
	if !strings.Contains(body, "</script>\n</BODY>") || strings.Contains(body, "</script>\n</HEAD>") {
		t.Fatalf("body placement: %s", body)
	}
	if cfg.active("/admin/settings") || cfg.active("/admin") || !cfg.active("/app") || !cfg.active("/login") || !cfg.active("/share/x") {
		t.Fatal("admin pages are excluded unless include_admin is on")
	}
	cfg.IncludeAdmin = true
	if !cfg.active("/admin/settings") {
		t.Fatal("include_admin enables admin pages")
	}
}

func TestTrackingValidation(t *testing.T) {
	reject := func(name string, overrides map[string]any) {
		t.Helper()
		if err := validateTrackingSettings(trackingTestConfig(overrides)); err == nil {
			t.Fatalf("%s must be rejected", name)
		}
	}
	accept := func(name string, overrides map[string]any) {
		t.Helper()
		if err := validateTrackingSettings(trackingTestConfig(overrides)); err != nil {
			t.Fatalf("%s must be accepted: %v", name, err)
		}
	}
	reject("oversized snippet", map[string]any{"tracking_custom_snippet": strings.Repeat("x", trackingMaxSnippetBytes+1)})
	accept("snippet at limit while off", map[string]any{"tracking_custom_snippet": strings.Repeat("x", trackingMaxSnippetBytes)})
	reject("unknown provider", map[string]any{"tracking_provider": "piwik"})
	reject("string enabled", map[string]any{"tracking_enabled": "true"})
	reject("bad placement", map[string]any{"tracking_placement": "footer"})
	reject("momento without site", map[string]any{"tracking_enabled": true, "tracking_provider": "momento", "tracking_momento_url": "https://m.example"})
	reject("momento with credentials", map[string]any{"tracking_momento_url": "https://user:pw@m.example"})
	reject("ga4 without id", map[string]any{"tracking_enabled": true, "tracking_provider": "ga4"})
	reject("custom empty", map[string]any{"tracking_enabled": true, "tracking_provider": "custom"})
	reject("allowed host injection", map[string]any{"tracking_allowed_hosts": "https://a.example; script-src *"})
	reject("allowed host not http", map[string]any{"tracking_allowed_hosts": "ftp://a.example"})
	accept("momento complete", map[string]any{"tracking_enabled": true, "tracking_provider": "momento", "tracking_momento_url": "https://m.example", "tracking_momento_site_id": "1"})
	accept("enabled with none provider", map[string]any{"tracking_enabled": true})
	accept("allowed hosts", map[string]any{"tracking_allowed_hosts": "https://a.example, https://*.b.example"})
}

func TestTrackingRecorderDedupesAndBounds(t *testing.T) {
	r := newTrackingRecorder()
	clock := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	r.now = func() time.Time { clock = clock.Add(time.Second); return clock }
	for i := 0; i < 5; i++ {
		r.record("https://momento.corp.example/collect/v1/events", "connect-src https://x", "/app")
	}
	r.record("chrome-extension://abc/x.js", "script-src-elem", "/app")
	r.record("data", "img-src", "/app")
	r.record("HTTPS://Momento.Corp.Example/tracker.js", "SCRIPT-SRC-ELEM", "/app/docs")
	cfg := readTrackingConfig(trackingTestConfig(map[string]any{"tracking_enabled": true, "tracking_provider": "custom", "tracking_custom_snippet": "<script src='https://momento.corp.example/t.js'></script>"}))
	items := r.list(cfg)
	if len(items) != 2 || items[0].Directive != "script-src-elem" || items[0].Origin != "https://momento.corp.example" || items[1].Count != 5 || !items[0].Allowed || !items[1].Allowed {
		t.Fatalf("violations: %+v", items)
	}
	if got := r.list(readTrackingConfig(defaultSettings())); got[0].Allowed {
		t.Fatal("allowed must follow the current configuration")
	}
	for i := 0; i < trackingMaxViolations+20; i++ {
		r.record("https://h"+strings.Repeat("x", i%7)+string(rune('a'+i%26))+strings.Repeat("y", i/26)+".example", "img-src", "/app")
	}
	if got := len(r.list(cfg)); got != trackingMaxViolations {
		t.Fatalf("recorder must hold at most %d origins, got %d", trackingMaxViolations, got)
	}
	r.forget()
	if len(r.list(cfg)) != 0 {
		t.Fatal("forget clears the recorder")
	}
	if got := trackingAddAllowedHost("https://a.example", "https://A.example/"); got != "https://a.example" {
		t.Fatalf("duplicate host appended: %s", got)
	}
	if got := trackingAddAllowedHost("", "https://b.example/"); got != "https://b.example" {
		t.Fatalf("first host: %s", got)
	}
	if got := trackingAddAllowedHost("https://a.example", "https://b.example"); got != "https://a.example, https://b.example" {
		t.Fatalf("appended host: %s", got)
	}
}
