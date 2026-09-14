package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// 방문 추적 스크립트는 관리자 설정에서 켜고, 요청마다 nonce 를 달아 화면에 넣는다.
// 화면 정책은 script-src 'self' 로 잠겨 있으므로 스니펫을 그냥 붙이면 조용히 차단된다.
// 'unsafe-inline' 으로 풀지 않고 nonce 와 스니펫에서 읽은 출처만 정책에 더한다.

const (
	trackingProviderNone    = "none"
	trackingProviderMomento = "momento"
	trackingProviderGA4     = "ga4"
	trackingProviderGTM     = "gtm"
	trackingProviderMatomo  = "matomo"
	trackingProviderCustom  = "custom"

	trackingMaxSnippetBytes = 8 * 1024
	trackingReportPath      = "/api/v1/tracking/csp-report"
	trackingMomentoPrefix   = "/momento"
)

// trackingProxyTransport 는 수집기 프록시가 공유하는 연결 풀이다. 요청마다 만들면 유휴 연결이 샌다.
var trackingProxyTransport = &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 90 * time.Second, MaxIdleConns: 16}

var trackingProviders = []string{trackingProviderNone, trackingProviderMomento, trackingProviderGA4, trackingProviderGTM, trackingProviderMatomo, trackingProviderCustom}

// basePagePolicy 는 추적이 꺼진 화면과 API 응답의 정책이다. 추적을 끄면 이 값으로 돌아간다.
const basePagePolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

// serviceOnlyPolicy 는 상태 점검과 프로토콜 경로처럼 화면이 아닌 응답의 정책이다. 화면보다 좁다.
const serviceOnlyPolicy = "default-src 'none'; frame-ancestors 'none'"

type trackingConfig struct {
	Enabled       bool
	Provider      string
	MomentoURL    string
	MomentoSiteID string
	MomentoProxy  bool
	MeasurementID string
	MatomoURL     string
	MatomoSiteID  string
	CustomSnippet string
	AllowedHosts  string
	IncludeAdmin  bool
	Placement     string
}

func defaultTrackingSettings() map[string]any {
	return map[string]any{
		"tracking_enabled": false, "tracking_provider": trackingProviderNone,
		"tracking_momento_url": "", "tracking_momento_site_id": "", "tracking_momento_proxy": true,
		"tracking_measurement_id": "", "tracking_matomo_url": "", "tracking_matomo_site_id": "",
		"tracking_custom_snippet": "", "tracking_allowed_hosts": "", "tracking_include_admin": false,
		"tracking_placement": "head",
	}
}

func readTrackingConfig(cfg map[string]any) trackingConfig {
	c := trackingConfig{
		Enabled: boolean(cfg, "tracking_enabled"), Provider: strings.ToLower(strings.TrimSpace(str(cfg, "tracking_provider"))),
		MomentoURL: strings.TrimSpace(str(cfg, "tracking_momento_url")), MomentoSiteID: strings.TrimSpace(str(cfg, "tracking_momento_site_id")),
		MomentoProxy: boolean(cfg, "tracking_momento_proxy"), MeasurementID: strings.TrimSpace(str(cfg, "tracking_measurement_id")),
		MatomoURL: strings.TrimSpace(str(cfg, "tracking_matomo_url")), MatomoSiteID: strings.TrimSpace(str(cfg, "tracking_matomo_site_id")),
		CustomSnippet: strings.TrimSpace(str(cfg, "tracking_custom_snippet")), AllowedHosts: str(cfg, "tracking_allowed_hosts"),
		IncludeAdmin: boolean(cfg, "tracking_include_admin"), Placement: strings.ToLower(strings.TrimSpace(str(cfg, "tracking_placement"))),
	}
	if c.Provider == "" {
		c.Provider = trackingProviderNone
	}
	if c.Placement != "body" {
		c.Placement = "head"
	}
	return c
}

func validateTrackingSettings(cfg map[string]any) error {
	for _, key := range []string{"tracking_enabled", "tracking_momento_proxy", "tracking_include_admin"} {
		if _, ok := cfg[key].(bool); !ok {
			return fmt.Errorf("%s 값은 true/false여야 합니다", key)
		}
	}
	c := readTrackingConfig(cfg)
	if !oneOf(c.Provider, trackingProviders...) {
		return errors.New("tracking_provider는 none, momento, ga4, gtm, matomo, custom 중 하나여야 합니다")
	}
	if !oneOf(strings.ToLower(strings.TrimSpace(str(cfg, "tracking_placement"))), "", "head", "body") {
		return errors.New("tracking_placement는 head 또는 body여야 합니다")
	}
	if len(c.CustomSnippet) > trackingMaxSnippetBytes {
		return fmt.Errorf("추적 코드는 %d바이트를 넘을 수 없습니다", trackingMaxSnippetBytes)
	}
	if len(c.AllowedHosts) > 4096 {
		return errors.New("추가 허용 출처 목록이 너무 깁니다")
	}
	for _, host := range trackingHostList(c.AllowedHosts) {
		if trackingOriginOf(host) == "" || !strings.HasPrefix(strings.ToLower(host), "http") || strings.ContainsAny(host, ";'\"") {
			return fmt.Errorf("허용 출처는 https://host 형식이어야 합니다: %s", host)
		}
	}
	for key, value := range map[string]string{"tracking_momento_url": c.MomentoURL, "tracking_matomo_url": c.MatomoURL} {
		if value == "" {
			continue
		}
		u, err := url.Parse(value)
		if err != nil || u.Hostname() == "" || u.Opaque != "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !oneOf(u.Scheme, "http", "https") {
			return fmt.Errorf("%s는 인증정보·쿼리·fragment 없는 HTTP(S) 주소여야 합니다", key)
		}
	}
	if !c.Enabled {
		return nil
	}
	switch c.Provider {
	case trackingProviderMomento:
		if c.MomentoURL == "" || c.MomentoSiteID == "" {
			return errors.New("Momento 수집기 주소와 사이트 ID를 입력하세요")
		}
	case trackingProviderGA4, trackingProviderGTM:
		if c.MeasurementID == "" {
			return errors.New("측정 ID를 입력하세요")
		}
	case trackingProviderMatomo:
		if c.MatomoURL == "" || c.MatomoSiteID == "" {
			return errors.New("Matomo 주소와 사이트 ID를 입력하세요")
		}
	case trackingProviderCustom:
		if c.CustomSnippet == "" {
			return errors.New("붙여넣을 추적 코드가 비어 있습니다")
		}
	}
	return nil
}

// active 는 이 경로의 화면에 스니펫을 붙일지 답한다. 관리 화면은 include_admin 이 켜졌을 때만이다.
func (c trackingConfig) active(path string) bool {
	if !c.Enabled || c.Provider == trackingProviderNone {
		return false
	}
	if !c.IncludeAdmin && strings.HasPrefix(path, "/admin") {
		return false
	}
	return strings.TrimSpace(c.snippet("")) != ""
}

// proxyActive 는 /momento/* 를 수집기로 넘길지 답한다. 프록시가 켜지면 외부 출처가 정책에 등장하지 않는다.
func (c trackingConfig) proxyActive() bool {
	return c.Enabled && c.Provider == trackingProviderMomento && c.MomentoProxy && trackingOriginOf(c.MomentoURL) != ""
}

// snippet 은 넣을 마크업이다. 모든 <script> 태그에 nonce 를 붙여 정책을 좁게 유지한다.
func (c trackingConfig) snippet(nonce string) string {
	switch c.Provider {
	case trackingProviderMomento:
		site := html.EscapeString(c.MomentoSiteID)
		base := strings.TrimRight(c.MomentoURL, "/")
		if site == "" || base == "" {
			return ""
		}
		if c.MomentoProxy {
			return trackingWithNonce(fmt.Sprintf(`<script async src="%s/tracker.js" data-site-id="%s" data-environment="prd" data-contract-version="1" data-endpoint="%s"></script>`, trackingMomentoPrefix, site, trackingMomentoPrefix), nonce)
		}
		return trackingWithNonce(fmt.Sprintf(`<script async src="%s/tracker.js" data-site-id="%s" data-environment="prd" data-contract-version="1"></script>`, html.EscapeString(base), site), nonce)
	case trackingProviderGA4:
		id := html.EscapeString(c.MeasurementID)
		if id == "" {
			return ""
		}
		return trackingWithNonce(fmt.Sprintf(`<script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','%s');</script>`, id, id), nonce)
	case trackingProviderGTM:
		id := html.EscapeString(c.MeasurementID)
		if id == "" {
			return ""
		}
		return trackingWithNonce(fmt.Sprintf(`<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','%s');</script>`, id), nonce)
	case trackingProviderMatomo:
		base := strings.TrimRight(c.MatomoURL, "/")
		site := html.EscapeString(c.MatomoSiteID)
		if base == "" || site == "" {
			return ""
		}
		return trackingWithNonce(fmt.Sprintf(`<script>var _paq=window._paq=window._paq||[];_paq.push(['trackPageView']);_paq.push(['enableLinkTracking']);(function(){var u="%s/";_paq.push(['setTrackerUrl',u+'matomo.php']);_paq.push(['setSiteId','%s']);var d=document,g=d.createElement('script'),s=d.getElementsByTagName('script')[0];g.async=true;g.src=u+'matomo.js';s.parentNode.insertBefore(g,s);})();</script>`, html.EscapeString(base), site), nonce)
	case trackingProviderCustom:
		return trackingWithNonce(c.CustomSnippet, nonce)
	}
	return ""
}

// policySources 는 스니펫이 필요로 하는 출처다. 붙여넣은 스니펫은 자기 주소를 로더 안에 적어 두므로
// 거기서 읽어 낸다. 관리자가 정책 오류를 호스트 이름으로 번역해 손으로 넣지 않아도 된다.
func (c trackingConfig) policySources() (scripts, connects, images []string) {
	add := func(origins ...string) {
		for _, origin := range origins {
			if origin == "" {
				continue
			}
			scripts = append(scripts, origin)
			connects = append(connects, origin)
			images = append(images, origin)
		}
	}
	switch c.Provider {
	case trackingProviderMomento:
		if !c.MomentoProxy {
			add(trackingOriginOf(c.MomentoURL))
		}
	case trackingProviderGA4, trackingProviderGTM:
		scripts = append(scripts, "https://www.googletagmanager.com")
		connects = append(connects, "https://www.google-analytics.com", "https://analytics.google.com", "https://*.google-analytics.com")
		images = append(images, "https://www.google-analytics.com", "https://www.googletagmanager.com")
	case trackingProviderMatomo:
		add(trackingOriginOf(c.MatomoURL))
	case trackingProviderCustom:
		add(trackingSnippetOrigins(c.CustomSnippet)...)
	}
	add(trackingHostList(c.AllowedHosts)...)
	return scripts, connects, images
}

// policy 는 화면 정책이다. 추적이 붙는 화면에만 nonce·출처·report-uri 를 더하고 나머지는 기본 정책 그대로다.
func (c trackingConfig) policy(path, nonce string) string {
	if !c.active(path) {
		return basePagePolicy
	}
	scripts, connects, images := c.policySources()
	scriptSrc := append([]string{"'self'", "'nonce-" + nonce + "'"}, scripts...)
	connectSrc := append([]string{"'self'"}, connects...)
	imgSrc := append([]string{"'self'", "data:", "blob:"}, images...)
	return "default-src 'self'; script-src " + strings.Join(scriptSrc, " ") +
		"; style-src 'self' 'unsafe-inline'; img-src " + strings.Join(imgSrc, " ") +
		"; font-src 'self'; connect-src " + strings.Join(connectSrc, " ") +
		"; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; report-uri " + trackingReportPath
}

// inject 는 index.html 의 placement 자리에 스니펫을 넣는다.
func (c trackingConfig) inject(page []byte, nonce string) []byte {
	snippet := c.snippet(nonce)
	if snippet == "" {
		return page
	}
	marker := "</head>"
	if c.Placement == "body" {
		marker = "</body>"
	}
	at := trackingIndexFold(string(page), marker)
	if at < 0 {
		return append(page, []byte("\n"+snippet+"\n")...)
	}
	out := make([]byte, 0, len(page)+len(snippet)+2)
	out = append(out, page[:at]...)
	out = append(out, snippet...)
	out = append(out, '\n')
	return append(out, page[at:]...)
}

// trackingIndexFold 는 ASCII 대소문자만 무시하고 sub 를 찾아 원본 인덱스를 돌려준다.
// strings.ToLower 의 인덱스를 원본에 쓰면 안 된다. U+212A(3바이트→'k' 1바이트)나
// U+0130 'İ'(2바이트→3바이트)처럼 접을 때 길이가 바뀌는 글자가 하나만 있어도 뒤 위치가 전부
// 어긋나 nonce 가 태그 이름 한가운데 박히고 추적이 조용히 멎는다. 찾는 문자열은 모두 ASCII 다.
func trackingIndexFold(s, sub string) int {
	if sub == "" {
		return 0
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			if foldASCIIByte(s[i+j]) != foldASCIIByte(sub[j]) {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}
func foldASCIIByte(b byte) byte {
	if b >= 'A' && b <= 'Z' {
		return b + ('a' - 'A')
	}
	return b
}

// trackingWithNonce 는 nonce 가 없는 모든 <script> 태그에 nonce 를 붙인다.
func trackingWithNonce(snippet, nonce string) string {
	if nonce == "" || snippet == "" {
		return snippet
	}
	var b strings.Builder
	rest := snippet
	for {
		at := trackingIndexFold(rest, "<script")
		if at < 0 {
			b.WriteString(rest)
			return b.String()
		}
		end := at + len("<script")
		b.WriteString(rest[:end])
		tag := rest[end:]
		if closing := strings.IndexByte(tag, '>'); closing >= 0 {
			tag = tag[:closing]
		}
		if trackingIndexFold(tag, "nonce=") < 0 {
			b.WriteString(` nonce="` + html.EscapeString(nonce) + `"`)
		}
		rest = rest[end:]
	}
}

// trackingSnippetOrigins 는 스니펫 안에 적힌 모든 http(s) 출처를 순서대로 돌려준다.
func trackingSnippetOrigins(snippet string) []string {
	var origins []string
	seen := map[string]bool{}
	for i := 0; i < len(snippet); {
		start := trackingIndexFold(snippet[i:], "http")
		if start < 0 {
			break
		}
		start += i
		end := start
		for end < len(snippet) && !trackingURLBoundary(snippet[end]) {
			end++
		}
		i = end
		origin := trackingOriginOf(snippet[start:end])
		if origin == "" || seen[origin] {
			continue
		}
		seen[origin] = true
		origins = append(origins, origin)
	}
	return origins
}
func trackingURLBoundary(b byte) bool {
	switch b {
	case '"', '\'', '`', '<', '>', ' ', '\t', '\n', '\r', ')', ',', ';', '\\', '+':
		return true
	}
	return false
}

// trackingOriginOf 는 http(s) URL 의 scheme://host 만 남긴다. 그 밖의 값은 빈 문자열이다.
func trackingOriginOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || !oneOf(strings.ToLower(u.Scheme), "http", "https") {
		return ""
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}
func trackingHostList(raw string) []string {
	var out []string
	for _, host := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\r' || r == '\t' }) {
		if host = strings.TrimSpace(strings.TrimSuffix(host, "/")); host != "" {
			out = append(out, host)
		}
	}
	return out
}

// trackingAddAllowedHost 는 허용 목록에 출처를 더한다. 이미 있으면 그대로 둔다.
func trackingAddAllowedHost(existing, origin string) string {
	origin = strings.TrimSpace(strings.TrimSuffix(origin, "/"))
	if origin == "" {
		return existing
	}
	for _, host := range trackingHostList(existing) {
		if strings.EqualFold(host, origin) {
			return existing
		}
	}
	if strings.TrimSpace(existing) == "" {
		return origin
	}
	return strings.TrimSpace(existing) + ", " + origin
}

// trackingSettings 는 추적 설정만 읽는다. 화면을 낼 때마다 부르므로 비밀 설정은 복호화하지 않는다.
func (s *Server) trackingSettings(ctx context.Context) trackingConfig {
	var raw []byte
	if e := s.DB.QueryRow(ctx, "SELECT data FROM settings WHERE id=1").Scan(&raw); e != nil {
		return trackingConfig{}
	}
	cfg := defaultTrackingSettings()
	stored := map[string]any{}
	if json.Unmarshal(raw, &stored) != nil {
		return trackingConfig{}
	}
	for key := range cfg {
		if value, ok := stored[key]; ok {
			cfg[key] = value
		}
	}
	return readTrackingConfig(cfg)
}

// servePage 는 index.html 을 낸다. 추적이 붙는 화면이면 nonce 를 만들어 스니펫과 정책을 함께 낸다.
func (s *Server) servePage(w http.ResponseWriter, r *http.Request, page []byte) {
	cfg := s.trackingSettings(r.Context())
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if !cfg.active(r.URL.Path) {
		w.Write(page)
		return
	}
	nonce := randomToken()
	w.Header().Set("Content-Security-Policy", cfg.policy(r.URL.Path, nonce))
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(cfg.inject(page, nonce))
}

func (s *Server) registerTracking() {
	s.mux.HandleFunc("POST "+trackingReportPath, s.trackingReport)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		s.mux.HandleFunc(method+" "+trackingMomentoPrefix+"/", s.trackingMomentoProxy)
	}
	s.admin("GET /api/v1/admin/tracking/violations", func(w http.ResponseWriter, r *http.Request) {
		cfg, e := s.settings(r.Context())
		if e != nil {
			respond(w, nil, e)
			return
		}
		jsonResponse(w, 200, map[string]any{"items": s.trackingViolations.list(readTrackingConfig(cfg))})
	})
	s.admin("DELETE /api/v1/admin/tracking/violations", func(w http.ResponseWriter, r *http.Request) {
		s.trackingViolations.forget()
		jsonResponse(w, 200, map[string]bool{"ok": true})
	})
}

// trackingReport 는 브라우저의 정책 위반 신고를 받는다. 추적이 켜진 동안에만 report-uri 가 정책에
// 들어가므로 꺼진 설치에서는 신고를 버린다.
func (s *Server) trackingReport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Report struct {
			BlockedURI         string `json:"blocked-uri"`
			EffectiveDirective string `json:"effective-directive"`
			ViolatedDirective  string `json:"violated-directive"`
			DocumentURI        string `json:"document-uri"`
		} `json:"csp-report"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body) != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if !s.trackingSettings(r.Context()).Enabled {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	directive := body.Report.EffectiveDirective
	if directive == "" {
		directive = body.Report.ViolatedDirective
	}
	page := ""
	if u, e := url.Parse(body.Report.DocumentURI); e == nil {
		page = u.Path
	}
	s.trackingViolations.record(body.Report.BlockedURI, directive, page)
	w.WriteHeader(http.StatusNoContent)
}

// trackingMomentoProxy 는 /momento/* 를 수집기로 넘긴다. 같은 오리진이 되므로 외부 출처가 정책에
// 등장하지 않는다. 세션 쿠키와 인증 헤더는 수집기로 보내지 않는다.
func (s *Server) trackingMomentoProxy(w http.ResponseWriter, r *http.Request) {
	cfg := s.trackingSettings(r.Context())
	if !cfg.proxyActive() {
		http.NotFound(w, r)
		return
	}
	target, e := url.Parse(strings.TrimRight(cfg.MomentoURL, "/"))
	if e != nil {
		http.NotFound(w, r)
		return
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(target)
			p.Out.URL.Path = strings.TrimSuffix(target.Path, "/") + strings.TrimPrefix(r.URL.Path, trackingMomentoPrefix)
			p.Out.URL.RawPath = ""
			p.Out.Host = target.Host
			p.Out.Header.Del("Cookie")
			p.Out.Header.Del("Authorization")
			p.SetXForwarded()
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			w.WriteHeader(http.StatusBadGateway)
		},
		Transport: trackingProxyTransport,
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	proxy.ServeHTTP(w, r)
}
