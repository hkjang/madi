package server

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Cross-service document handoff (HANDOFF-STANDARD.md). madi sends and
// receives Markdown only. A claim is a single-use, five-minute ticket bound to
// one document the issuing user can read; the receiving service fetches the
// body from the sender with nothing but that ticket.

//go:embed handoff.sql
var handoffSchema string

const (
	handoffClaimTTL = 5 * time.Minute
	// Receive-side ceiling. The standard's default is 25MB, but madi stores a
	// document body of at most 4MB, so anything larger can never be imported.
	handoffMaxBytes = 4 << 20
	handoffTimeout  = 30 * time.Second
	handoffFormat   = "markdown"
	handoffMIME     = "text/markdown; charset=utf-8"
)

// Formats each standard service accepts. Send buttons only appear for services
// that can take Markdown; the list of origins comes from the admin allow list.
var handoffServiceAccepts = map[string][]string{
	"umm":    {},
	"muni":   {"markdown"},
	"kanpic": {"csv", "xlsx"},
	"ptium":  {"markdown", "docx", "csv", "xlsx", "txt"},
	"weekly": {"markdown", "docx", "pptx"},
	"madi":   {"markdown"},
}

type handoffPeer struct {
	Service string `json:"service"`
	Origin  string `json:"origin"`
}

func (s *Server) migrateHandoff(ctx context.Context) error {
	_, e := s.DB.Exec(ctx, handoffSchema)
	return e
}

// handoffOrigin canonicalises an origin string: http(s) scheme and host only,
// lower-cased, without credentials, path, query or fragment.
func handoffOrigin(raw string) (string, bool) {
	u, e := url.Parse(strings.TrimSpace(raw))
	if e != nil || u.Host == "" || u.Opaque != "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !oneOf(strings.ToLower(u.Scheme), "http", "https") {
		return "", false
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host), true
}

func handoffPeers(cfg map[string]any) []handoffPeer {
	out := []handoffPeer{}
	raw, _ := cfg["handoff_allowed_origins"].([]any)
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		origin, ok := handoffOrigin(str(m, "origin"))
		if !ok {
			continue
		}
		out = append(out, handoffPeer{Service: str(m, "service"), Origin: origin})
	}
	return out
}

func validateHandoffSettings(cfg map[string]any) error {
	raw, ok := cfg["handoff_allowed_origins"].([]any)
	if !ok || len(raw) > 100 {
		return errors.New("문서 넘기기 허용 목록은 최대 100개 배열입니다")
	}
	seen := map[string]bool{}
	for _, item := range raw {
		m, ok := item.(map[string]any)
		if !ok {
			return errors.New("문서 넘기기 허용 목록 항목은 service와 origin을 가진 객체여야 합니다")
		}
		if _, known := handoffServiceAccepts[str(m, "service")]; !known {
			return errors.New("문서 넘기기 서비스 이름은 umm·muni·kanpic·ptium·weekly·madi 중 하나여야 합니다")
		}
		origin, ok := handoffOrigin(str(m, "origin"))
		if !ok || len(str(m, "origin")) > 2048 {
			return errors.New("문서 넘기기 오리진은 경로·쿼리·인증정보 없는 HTTP(S) 주소여야 합니다")
		}
		if seen[origin] {
			return errors.New("문서 넘기기 허용 목록에 같은 오리진이 두 번 있습니다")
		}
		seen[origin] = true
	}
	return nil
}

func handoffFilename(title string) string {
	name := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || strings.ContainsRune(`/\:*?"<>|`, r) {
			return ' '
		}
		return r
	}, title)
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, ".") {
		name = "문서"
	}
	for len(name) > 200 {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size]
	}
	return name + ".md"
}

// handoffContentDisposition builds the RFC 6266/5987 header for a filename.
// url.PathEscape is not suitable here: it leaves `=`, `@`, `:` and friends
// bare, and a bare `=` inside the ext-value makes mime.ParseMediaType (and
// stricter parsers on other services) reject the whole header. Only RFC 5987
// attr-char bytes pass through; every other byte becomes %XX.
func handoffContentDisposition(filename string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	b.WriteString("attachment; filename*=UTF-8''")
	for i := 0; i < len(filename); i++ {
		c := filename[i]
		switch {
		case 'A' <= c && c <= 'Z', 'a' <= c && c <= 'z', '0' <= c && c <= '9':
			b.WriteByte(c)
		case strings.IndexByte("!#$&+-.^_`|~", c) >= 0:
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&0x0f])
		}
	}
	return b.String()
}

func (s *Server) registerHandoff() {
	s.handle("GET /api/v1/handoff/targets", s.handoffTargets)
	s.handle("POST /api/v1/handoff/claims", s.issueHandoffClaim)
	// The claim is the credential: no session, no API key. Registered outside
	// the auth stack on purpose; the pattern (not the path) is what gets logged.
	s.mux.HandleFunc("GET /api/v1/handoff/claims/{claim}", s.redeemHandoffClaim)
	s.mux.HandleFunc("GET /handoff", s.receiveHandoff)
}

// handoffTargets lists allow-listed services that can receive Markdown. An
// empty allow list (the default) yields no targets, so no button is shown.
func (s *Server) handoffTargets(w http.ResponseWriter, r *http.Request) {
	cfg, e := s.settings(r.Context())
	if e != nil {
		respond(w, nil, e)
		return
	}
	out := []handoffPeer{}
	for _, peer := range handoffPeers(cfg) {
		if oneOf(handoffFormat, handoffServiceAccepts[peer.Service]...) {
			out = append(out, peer)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Service < out[j].Service })
	jsonResponse(w, 200, out)
}

func (s *Server) issueHandoffClaim(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if decode(r, &in) != nil {
		apiError(w, 400, "요청 본문을 확인하세요")
		return
	}
	if str(in, "format") != handoffFormat {
		apiError(w, 400, "이 서비스는 markdown 형식만 보냅니다")
		return
	}
	id := str(in, "resource")
	if !s.canDocument(r.Context(), current(r), id, false) {
		apiError(w, 404, "문서를 찾을 수 없습니다")
		return
	}
	var title, markdown string
	if e := s.DB.QueryRow(r.Context(), "SELECT title,markdown FROM documents WHERE id=$1 AND deleted_at IS NULL", id).Scan(&title, &markdown); e != nil {
		respond(w, nil, e)
		return
	}
	cfg, e := s.settings(r.Context())
	if e != nil {
		respond(w, nil, e)
		return
	}
	source, ok := handoffOrigin(str(cfg, "site_url"))
	if !ok {
		apiError(w, 409, "관리자 설정의 서비스 URL을 먼저 확인하세요")
		return
	}
	claim := randomToken()
	filename := handoffFilename(title)
	expires := time.Now().Add(handoffClaimTTL)
	// Opportunistic sweep: expired tickets carry no value and need no history.
	_, _ = s.DB.Exec(r.Context(), "DELETE FROM handoff_claims WHERE expires_at < now() - interval '1 day'")
	if _, e = s.DB.Exec(r.Context(), "INSERT INTO handoff_claims(claim_hash,document_id,user_id,format,filename,expires_at) VALUES($1,$2,$3,$4,$5,$6)", digest(claim), id, current(r).ID, handoffFormat, filename, expires); e != nil {
		respond(w, nil, e)
		return
	}
	s.audit(r, "HANDOFF_CLAIM", id, map[string]any{"format": handoffFormat})
	jsonResponse(w, 201, map[string]any{"claim": claim, "source": source, "filename": filename, "content_type": handoffMIME, "bytes": len(markdown), "expires_at": expires.Format(time.RFC3339)})
}

func (s *Server) redeemHandoffClaim(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	claim := r.PathValue("claim")
	if len(claim) < 32 || len(claim) > 128 {
		apiError(w, 404, "표를 찾을 수 없습니다")
		return
	}
	// A single UPDATE both checks and consumes the ticket, so two concurrent
	// requests cannot both succeed. Expired, used and unknown all read alike.
	var id, filename string
	e := s.DB.QueryRow(r.Context(), "UPDATE handoff_claims SET used_at=now() WHERE claim_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING document_id::text,filename", digest(claim)).Scan(&id, &filename)
	if e == nil {
		var title, markdown string
		e = s.DB.QueryRow(r.Context(), "SELECT title,markdown FROM documents WHERE id=$1 AND deleted_at IS NULL", id).Scan(&title, &markdown)
		if e == nil {
			w.Header().Set("Content-Type", handoffMIME)
			w.Header().Set("Content-Disposition", handoffContentDisposition(filename))
			w.WriteHeader(200)
			_, _ = io.WriteString(w, markdown)
			return
		}
	}
	if errors.Is(e, pgx.ErrNoRows) {
		apiError(w, 404, "표를 찾을 수 없습니다")
		return
	}
	respond(w, nil, e)
}

// handoffPage renders the human-readable failure screen the standard asks for.
func handoffPage(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	fmt.Fprintf(w, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>문서 넘기기 · madi</title><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#1f2937}main{max-width:32rem;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}a{color:#2563eb}</style></head><body><main><h1>문서를 받지 못했습니다</h1><p>%s</p><p><a href="/app">madi로 돌아가기</a></p></main></body></html>`, html.EscapeString(message))
}

// handoffFetch pulls a claim body from an allow-listed origin. It never follows
// redirects, bounds time and size, and rejects bodies that are not Markdown.
func handoffFetch(ctx context.Context, client *http.Client, origin, claim string) (title, markdown string, err error) {
	ctx, cancel := context.WithTimeout(ctx, handoffTimeout)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/api/v1/handoff/claims/"+url.PathEscape(claim), nil)
	if e != nil {
		return "", "", errors.New("원본 주소를 만들지 못했습니다")
	}
	req.Header.Set("Accept", "text/markdown")
	res, e := client.Do(req)
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			return "", "", errors.New("원본 서비스가 30초 안에 응답하지 않았습니다")
		}
		return "", "", errors.New("원본 서비스에 연결하지 못했습니다")
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode < 400 {
		return "", "", errors.New("원본 서비스가 다른 주소로 보내려 했습니다. 리다이렉트는 따르지 않습니다")
	}
	if res.StatusCode == 404 {
		return "", "", errors.New("표가 만료됐거나 이미 사용됐습니다. 보낸 쪽에서 다시 보내세요")
	}
	if res.StatusCode != 200 {
		return "", "", fmt.Errorf("원본 서비스가 %d로 응답했습니다", res.StatusCode)
	}
	mediaType, _, e := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if e != nil || !oneOf(mediaType, "text/markdown", "text/x-markdown") {
		return "", "", errors.New("받은 문서의 형식을 읽을 수 없습니다 (markdown이 아님)")
	}
	body, e := io.ReadAll(io.LimitReader(res.Body, handoffMaxBytes+1))
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			return "", "", errors.New("원본 서비스가 30초 안에 응답하지 않았습니다")
		}
		return "", "", errors.New("원본 서비스에서 본문을 받지 못했습니다")
	}
	if len(body) > handoffMaxBytes {
		return "", "", errors.New("받은 문서가 너무 큽니다 (4MB 초과)")
	}
	if !utf8.Valid(body) {
		return "", "", errors.New("받은 문서의 형식을 읽을 수 없습니다 (UTF-8이 아님)")
	}
	title = "가져온 문서"
	if _, params, e := mime.ParseMediaType(res.Header.Get("Content-Disposition")); e == nil {
		name := path.Base(strings.ReplaceAll(params["filename"], "\\", "/"))
		name = strings.TrimSuffix(strings.TrimSuffix(name, ".md"), ".markdown")
		name = strings.TrimSpace(strings.Map(func(r rune) rune {
			if r < 0x20 || r == 0x7f {
				return ' '
			}
			return r
		}, name))
		if name != "" && name != "." && name != "/" && len(name) <= 500 {
			title = name
		}
	}
	return title, string(body), nil
}

// receiveHandoff is the browser entry point: GET /handoff?source=&claim=.
// The source must be on the admin allow list before any request is made.
func (s *Server) receiveHandoff(w http.ResponseWriter, r *http.Request) {
	p, e := s.sessionPrincipal(r)
	if e != nil {
		handoffPage(w, 401, "madi에 로그인한 뒤 보낸 쪽에서 다시 보내세요. 표는 5분 동안만 유효합니다.")
		return
	}
	r = r.WithContext(context.WithValue(r.Context(), principalKey, p))
	q := r.URL.Query()
	claim := q.Get("claim")
	source, ok := handoffOrigin(q.Get("source"))
	if !ok || claim == "" || len(claim) > 128 {
		handoffPage(w, 400, "source와 claim 값을 확인하세요.")
		return
	}
	cfg, e := s.settings(r.Context())
	if e != nil {
		handoffPage(w, 500, "설정을 읽지 못했습니다.")
		return
	}
	allowed := false
	for _, peer := range handoffPeers(cfg) {
		if peer.Origin == source {
			allowed = true
			break
		}
	}
	if !allowed {
		handoffPage(w, 403, "허용 목록에 없는 출처입니다. 관리자에게 "+source+" 등록을 요청하세요.")
		return
	}
	if p.Role == "viewer" {
		handoffPage(w, 403, "문서를 만들 권한이 없습니다.")
		return
	}
	var wid string
	if e = s.DB.QueryRow(r.Context(), "SELECT w.id::text FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.role IN ('owner','admin','editor') ORDER BY w.created_at LIMIT 1", p.ID).Scan(&wid); e != nil {
		handoffPage(w, 403, "문서를 만들 수 있는 워크스페이스가 없습니다.")
		return
	}
	title, markdown, e := handoffFetch(r.Context(), s.handoffClient(), source, claim)
	if e != nil {
		handoffPage(w, 502, e.Error())
		return
	}
	did, e := s.storeHandoffDocument(r, p, wid, source, title, markdown)
	if e != nil {
		handoffPage(w, 500, "문서를 저장하지 못했습니다.")
		return
	}
	http.Redirect(w, r, "/app/documents/"+did, http.StatusFound)
}

func (s *Server) handoffClient() *http.Client {
	return &http.Client{Timeout: handoffTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// storeHandoffDocument creates a private draft the same way inbound capture
// does, and records where it came from so the origin can be traced later.
func (s *Server) storeHandoffDocument(r *http.Request, p *Principal, wid, source, title, markdown string) (string, error) {
	ctx := r.Context()
	did := newID()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	protected, e := s.ProtectDocumentTx(ctx, tx, p, did, wid, title, markdown)
	if e != nil {
		return "", e
	}
	if _, e = tx.Exec(ctx, "INSERT INTO documents(id,workspace_id,title,markdown,visibility,owner_id,tags,aliases,block_metadata) VALUES($1,$2,$3,$4,'private',$5,'[\"handoff\"]','[]','{}')", did, wid, protected.Title, protected.Markdown, p.ID); e != nil {
		return "", e
	}
	if _, e = tx.Exec(ctx, "INSERT INTO document_versions(document_id,version,title,markdown,tags,user_id,block_metadata) SELECT id,version,title,markdown,tags,owner_id,block_metadata FROM documents WHERE id=$1", did); e != nil {
		return "", e
	}
	meta := map[string]any{"origin": "handoff", "source": source, "filename": title, "received_at": time.Now().Format(time.RFC3339)}
	protectedMeta, e := s.ProtectDocumentMetadataTx(ctx, tx, p, did, wid, meta)
	if e != nil {
		return "", e
	}
	if _, e = tx.Exec(ctx, "INSERT INTO knowledge_document_meta(document_id,kind,system_metadata) VALUES($1,'inbox',$2)", did, jsonValue(protectedMeta.Value)); e != nil {
		return "", e
	}
	if e = s.enqueueEvent(ctx, tx, Event{Type: "document.created", WorkspaceID: wid, ActorID: p.ID, ResourceID: did, After: map[string]any{"id": did, "title": protected.Title, "visibility": "private", "status": "draft", "version": 1}}); e != nil {
		return "", e
	}
	if e = tx.Commit(ctx); e != nil {
		return "", e
	}
	s.audit(r, "HANDOFF_RECEIVE", did, map[string]any{"source": source})
	return did, nil
}
