package server

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMailConfigDefaultsAndFallbacks(t *testing.T) {
	cfg := mailConfigFrom(defaultSettings())
	if cfg.Enabled || cfg.Port != 25 || cfg.Security != "auto" || cfg.Timeout != 10*time.Second || cfg.SkipVerify || cfg.Username != "" {
		t.Fatalf("defaults must describe an internal relay on port 25 without credentials: %+v", cfg)
	}
	for event := range mailEventSettings {
		if !cfg.allows(event) {
			t.Fatalf("event %s must be on by default", event)
		}
	}
	if !cfg.allows("future.event") {
		t.Fatal("unknown events are sent without a settings change")
	}
	settings := defaultSettings()
	settings["mail.smtp_host"] = "relay.company.internal"
	settings["mail.smtp_port"] = float64(465)
	settings["site_url"] = "https://madi.company.internal/"
	settings["mail.notify_task_assigned"] = false
	cfg = mailConfigFrom(settings)
	if cfg.FromAddress != "madi@relay.company.internal" || cfg.FromName != "madi" || cfg.Security != "tls" || cfg.BaseURL != "https://madi.company.internal" {
		t.Fatalf("fallbacks: %+v", cfg)
	}
	if cfg.allows(mailEventTaskAssigned) || !cfg.allows(mailEventApprovalRequested) {
		t.Fatal("a switch turns off only its own event")
	}
	if cfg.link("/app/approvals") != "https://madi.company.internal/app/approvals" {
		t.Fatal(cfg.link("/app/approvals"))
	}
	settings["mail.base_url"] = "http://mail-link.internal/"
	if mailConfigFrom(settings).link("app/inbox") != "http://mail-link.internal/app/inbox" {
		t.Fatal("mail.base_url overrides site_url")
	}
}

func TestValidateMailSettings(t *testing.T) {
	base := defaultSettings()
	if e := validateSettings(base); e != nil {
		t.Fatalf("default settings must validate: %v", e)
	}
	cases := []struct {
		name  string
		patch map[string]any
		ok    bool
	}{
		{"enabled without host", map[string]any{"mail.enabled": true}, false},
		{"enabled with host", map[string]any{"mail.enabled": true, "mail.smtp_host": "relay.internal"}, true},
		{"host with port", map[string]any{"mail.smtp_host": "relay.internal:25"}, false},
		{"bad security", map[string]any{"mail.security": "ssl"}, false},
		{"port out of range", map[string]any{"mail.smtp_port": float64(70000)}, false},
		{"fractional timeout", map[string]any{"mail.timeout_seconds": 2.5}, false},
		{"timeout too long", map[string]any{"mail.timeout_seconds": float64(600)}, false},
		{"bad from", map[string]any{"mail.from_address": "not-an-address"}, false},
		{"header injection in from", map[string]any{"mail.from_address": "a@b.test\r\nBcc: c@d.test"}, false},
		{"bad base url", map[string]any{"mail.base_url": "ftp://x"}, false},
		{"password newline", map[string]any{"mail.password": "a\nb"}, false},
		{"switch not bool", map[string]any{"mail.notify_runbook": "yes"}, false},
		{"optional auth", map[string]any{"mail.enabled": true, "mail.smtp_host": "10.0.0.5", "mail.username": "madi", "mail.password": "secret", "mail.security": "starttls", "mail.skip_tls_verify": true}, true},
	}
	for _, c := range cases {
		cfg := defaultSettings()
		for k, v := range c.patch {
			cfg[k] = v
		}
		if e := validateMailSettings(cfg); (e == nil) != c.ok {
			t.Errorf("%s: ok=%v error=%v", c.name, c.ok, e)
		}
	}
}

func TestMailPasswordIsNeverReturned(t *testing.T) {
	cfg := defaultSettings()
	cfg["mail.password"] = "relay-secret-2026"
	out := redactSettings(cfg)
	if str(out, "mail.password") != "" || out["mail.password_configured"] != true {
		t.Fatalf("password must be redacted to a configured flag: %v %v", out["mail.password"], out["mail.password_configured"])
	}
	if strings.Contains(string(jsonValue(out)), "relay-secret-2026") {
		t.Fatal("secret escaped the redacted settings")
	}
}

func TestMailComposeAndRender(t *testing.T) {
	settings := defaultSettings()
	settings["site_name"] = "우리 지식"
	settings["site_url"] = "https://madi.test"
	settings["mail.smtp_host"] = "relay.test"
	settings["mail.from_address"] = "noreply@madi.test"
	settings["mail.from_name"] = "마디 알림"
	settings["mail.password"] = "hunter2-secret"
	cfg := mailConfigFrom(settings)
	notice := mailNotice{Event: mailEventReviewDue, Items: []mailNoticeItem{{Title: "문서 검토 주기가 지났습니다: 운영 절차", DocumentID: "11111111-1111-4111-8111-111111111111"}, {Title: ".시작이 점인 제목"}}}
	subject, body := notice.subject(cfg), notice.render(cfg)
	if subject != "[우리 지식] 검토 주기가 지난 문서가 있습니다 (2건)" {
		t.Fatal(subject)
	}
	if !strings.Contains(body, "https://madi.test/app/documents/11111111-1111-4111-8111-111111111111") || !strings.Contains(body, "바로 열기: https://madi.test/app/knowledge-time") || !strings.Contains(body, "- .시작이 점인 제목") {
		t.Fatal(body)
	}
	raw := mailCompose(cfg, mailMessage{To: "person@madi.test", Subject: subject, Body: body})
	for _, want := range []string{"From: =?utf-8?q?", " <noreply@madi.test>\r\n", "To: person@madi.test\r\n", "Subject: =?utf-8?q?", "Content-Type: text/plain; charset=UTF-8\r\n", "Auto-Submitted: auto-generated\r\n", "\r\n- .시작이 점인 제목\r\n"} {
		if !strings.Contains(raw, want) {
			t.Fatalf("missing %q in\n%s", want, raw)
		}
	}
	if strings.Contains(raw, "hunter2-secret") {
		t.Fatal("message leaks the password")
	}
	if stuffed := mailBody(".첫 줄\n둘째\n.\n셋째"); stuffed != "..첫 줄\r\n둘째\r\n..\r\n셋째\r\n" {
		t.Fatalf("dot stuffing: %q", stuffed)
	}
	if single := (mailNotice{Event: mailEventTaskAssigned, Items: []mailNoticeItem{{Title: "x"}}}).subject(cfg); single != "[우리 지식] 담당할 할 일이 지정되었습니다" {
		t.Fatal(single)
	}
	if mailHelloName(cfg) != "madi.test" {
		t.Fatal(mailHelloName(cfg))
	}
}

// fakeSMTPRelay answers like a plain port-25 relay: no STARTTLS, no AUTH.
func fakeSMTPRelay(t *testing.T) (int, <-chan string) {
	t.Helper()
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { listener.Close() })
	messages := make(chan string, 8)
	go func() {
		for {
			conn, e := listener.Accept()
			if e != nil {
				return
			}
			go func() {
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
				rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
				send := func(text string) { fmt.Fprint(rw, text+"\r\n"); _ = rw.Flush() }
				send("220 relay.test ESMTP")
				for {
					line, e := rw.ReadString('\n')
					if e != nil {
						return
					}
					switch {
					case strings.HasPrefix(line, "EHLO"), strings.HasPrefix(line, "HELO"):
						send("250-relay.test\r\n250 8BITMIME")
					case strings.HasPrefix(line, "MAIL FROM"), strings.HasPrefix(line, "RCPT TO"):
						send("250 OK")
					case strings.HasPrefix(line, "DATA"):
						send("354 end with dot")
						var body strings.Builder
						for {
							v, e := rw.ReadString('\n')
							if e != nil {
								return
							}
							if v == ".\r\n" {
								break
							}
							body.WriteString(v)
						}
						messages <- body.String()
						send("250 accepted")
					case strings.HasPrefix(line, "QUIT"):
						send("221 bye")
						return
					default:
						send("500 unsupported")
					}
				}
			}()
		}
	}()
	return listener.Addr().(*net.TCPAddr).Port, messages
}

func TestMailDeliverThroughPlainRelayAndDeadRelay(t *testing.T) {
	port, messages := fakeSMTPRelay(t)
	settings := defaultSettings()
	settings["mail.smtp_host"] = "127.0.0.1"
	settings["mail.smtp_port"] = float64(port)
	settings["mail.timeout_seconds"] = float64(5)
	cfg := mailConfigFrom(settings)
	if e := mailDeliver(context.Background(), cfg, mailMessage{To: "person@example.test", Subject: "안녕", Body: "본문"}); e != nil {
		t.Fatalf("auto security must fall back to plain text when the relay offers no STARTTLS: %v", e)
	}
	select {
	case body := <-messages:
		if !strings.Contains(body, "To: person@example.test") || !strings.Contains(body, "본문\r\n") {
			t.Fatal(body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("relay received nothing")
	}
	cfg.Security = "starttls"
	if e := mailDeliver(context.Background(), cfg, mailMessage{To: "person@example.test", Subject: "x", Body: "y"}); e == nil || !strings.Contains(e.Error(), "STARTTLS") {
		t.Fatalf("explicit starttls must refuse a relay without it: %v", e)
	}
	cfg.Security = "auto"
	cfg.Username = "madi"
	if e := mailDeliver(context.Background(), cfg, mailMessage{To: "person@example.test", Subject: "x", Body: "y"}); e == nil || !strings.Contains(e.Error(), "인증") {
		t.Fatalf("credentials against a relay without AUTH must explain themselves: %v", e)
	}
	closed, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	deadPort := closed.Addr().(*net.TCPAddr).Port
	closed.Close()
	cfg.Username = ""
	cfg.Port = deadPort
	started := time.Now()
	if e := mailDeliver(context.Background(), cfg, mailMessage{To: "person@example.test", Subject: "x", Body: "y"}); e == nil || !strings.Contains(e.Error(), "SMTP 연결 실패") {
		t.Fatalf("dead relay: %v", e)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("dead relay must fail within the configured timeout")
	}
}

type mailRecorder struct {
	mu       sync.Mutex
	sent     []mailMessage
	failFor  string
	failures int
}

func (r *mailRecorder) send(_ context.Context, _ mailConfig, m mailMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failFor != "" && m.To == r.failFor {
		r.failures++
		return fmt.Errorf("RCPT TO 거부: 550 mailbox unavailable")
	}
	r.sent = append(r.sent, m)
	return nil
}
func (r *mailRecorder) fail(recipient string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.failFor = recipient
}
func (r *mailRecorder) messages() []mailMessage {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]mailMessage{}, r.sent...)
}

func TestPostgresMailEventDispatch(t *testing.T) {
	s, ts := integrationTestServer(t)
	admin := newIntegrationTestClient(t, ts.URL)
	admin.request("POST", "/api/v1/auth/login", map[string]any{"email": "admin@example.test", "password": "Integration-Test-Password-2026!"}, 200)
	ctx := context.Background()
	recorder := &mailRecorder{}
	s.mailSend = recorder.send
	var adminID, wid string
	if e := s.DB.QueryRow(ctx, "SELECT user_id::text,workspace_id::text FROM workspace_members WHERE role='owner' LIMIT 1").Scan(&adminID, &wid); e != nil {
		t.Fatal(e)
	}
	editor := testJSONObject(t, admin.request("POST", "/api/v1/admin/users", map[string]any{"email": "editor@example.test", "name": "편집자", "role": "editor", "password": "Editor-Mail-Password-2026!"}, 200))
	editorID := str(editor, "id")
	admin.request("PUT", "/api/v1/workspaces/"+wid+"/members", map[string]any{"email": "editor@example.test", "role": "editor"}, 200)
	insert := func(userID, actorID, event, title, documentID string) string {
		id := newID()
		if _, e := s.DB.Exec(ctx, "INSERT INTO notifications(id,user_id,title,document_id,mail_event,actor_id) VALUES($1,$2,$3,NULLIF($4,'')::uuid,NULLIF($5,''),NULLIF($6,'')::uuid)", id, userID, title, documentID, event, actorID); e != nil {
			t.Fatal(e)
		}
		return id
	}
	dispatch := func() {
		t.Helper()
		if e := s.dispatchMail(ctx); e != nil {
			t.Fatal(e)
		}
	}
	countDeliveries := func(where string, args ...any) int {
		var n int
		if e := s.DB.QueryRow(ctx, "SELECT count(*) FROM mail_deliveries WHERE "+where, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	waitFor := func(condition func() bool) {
		t.Helper()
		for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
			if condition() {
				return
			}
		}
		t.Fatal("condition not met in time")
	}

	// Off by default: the event is recorded in the app, nothing is mailed and
	// the outbox row is consumed so enabling later never replays it.
	untagged := insert(editorID, "", "", "메일 대상이 아닌 알림", "")
	stale := insert(editorID, adminID, mailEventApprovalRequested, "꺼져 있을 때 생긴 요청", "")
	var outbox int
	if e := s.DB.QueryRow(ctx, "SELECT count(*) FROM mail_outbox WHERE notification_id=ANY($1::uuid[])", []string{untagged, stale}).Scan(&outbox); e != nil || outbox != 1 {
		t.Fatalf("only tagged notifications enter the mail outbox: %d %v", outbox, e)
	}
	dispatch()
	if countDeliveries("true") != 0 || len(recorder.messages()) != 0 {
		t.Fatal("nothing may be sent while mail is off")
	}
	if e := s.DB.QueryRow(ctx, "SELECT count(*) FROM mail_outbox WHERE processed_at IS NULL").Scan(&outbox); e != nil || outbox != 0 {
		t.Fatalf("outbox must be drained even while off: %d %v", outbox, e)
	}

	// Enabling with a password: the API returns only a configured flag.
	saved := testJSONObject(t, admin.request("PUT", "/api/v1/admin/settings", map[string]any{"site_url": "https://madi.example.test", "mail.enabled": true, "mail.smtp_host": "relay.example.test", "mail.username": "madi", "mail.password": "relay-secret-2026", "mail.from_address": "noreply@example.test"}, 200))
	if str(saved, "mail.password") != "" || saved["mail.password_configured"] != true || strings.Contains(string(jsonValue(saved)), "relay-secret-2026") {
		t.Fatal("mail.password must never be returned")
	}
	fetched := admin.request("GET", "/api/v1/admin/settings", nil, 200)
	if strings.Contains(string(fetched), "relay-secret-2026") || !strings.Contains(string(fetched), `"mail.password_configured":true`) {
		t.Fatal("GET settings leaked or lost the password state")
	}
	cfg, e := s.settings(ctx)
	if e != nil || str(cfg, "mail.password") != "relay-secret-2026" {
		t.Fatal("the decoded password must still reach the transport")
	}
	// Saving other fields with an empty password keeps the stored one.
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mail.password": "", "mail.from_name": "마디"}, 200)
	if cfg, _ = s.settings(ctx); str(cfg, "mail.password") != "relay-secret-2026" {
		t.Fatal("an empty password on save must not clear the stored secret")
	}

	// Own actions are not mailed; two notifications for one person and event
	// go out as one message; a disabled switch stops only its own event.
	insert(adminID, adminID, mailEventApprovalDecided, "내가 처리한 검토", "")
	doc := testJSONObject(t, admin.request("POST", "/api/v1/documents", map[string]any{"workspace_id": wid, "title": "운영 절차", "markdown": "본문", "visibility": "workspace"}, 200))
	docID := str(doc, "id")
	insert(editorID, "", mailEventReviewDue, "문서 검토 주기가 지났습니다: 운영 절차", docID)
	insert(editorID, "", mailEventReviewDue, "문서 검토 주기가 지났습니다: 배포 절차", "")
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mail.notify_task_assigned": false}, 200)
	insert(editorID, adminID, mailEventTaskAssigned, "담당할 할 일이 지정되었습니다.", docID)
	dispatch()
	waitFor(func() bool { return countDeliveries("status='sent'") == 1 })
	if countDeliveries("true") != 1 || countDeliveries("event=$1 AND recipient='editor@example.test' AND notifications=2 AND status='sent' AND attempts=1", mailEventReviewDue) != 1 {
		t.Fatal("expected exactly one bundled review_due delivery")
	}
	sent := recorder.messages()
	if len(sent) != 1 || sent[0].To != "editor@example.test" || !strings.Contains(sent[0].Subject, "(2건)") || !strings.Contains(sent[0].Body, "운영 절차") || !strings.Contains(sent[0].Body, "배포 절차") || !strings.Contains(sent[0].Body, "https://madi.example.test/app/documents/"+docID) {
		t.Fatalf("bundled message: %+v", sent)
	}

	// The relay's refusal is recorded with both attempts and no body.
	recorder.fail("editor@example.test")
	insert(editorID, adminID, mailEventAccessDecided, "문서 접근 권한 요청이 처리되었습니다. SECRET_BODY_MARKER", "")
	dispatch()
	waitFor(func() bool { return countDeliveries("status='failed'") == 1 })
	var attempts int
	var message string
	if e := s.DB.QueryRow(ctx, "SELECT attempts,error_message FROM mail_deliveries WHERE status='failed'").Scan(&attempts, &message); e != nil || attempts != 2 || !strings.Contains(message, "550") {
		t.Fatalf("failed delivery record: %d %q %v", attempts, message, e)
	}
	recorder.fail("")

	// A real event path: an access request tags the owner's notification with
	// the requester as actor, and the request itself never waits on mail.
	requester := newIntegrationTestClient(t, ts.URL)
	requester.request("POST", "/api/v1/auth/login", map[string]any{"email": "editor@example.test", "password": "Editor-Mail-Password-2026!"}, 200)
	private := str(testJSONObject(t, admin.request("POST", "/api/v1/documents", map[string]any{"workspace_id": wid, "title": "비공개 절차", "markdown": "private", "visibility": "private"}, 200)), "id")
	requester.request("POST", "/api/v1/documents/"+private+"/access-requests", map[string]any{"workspace_id": wid, "permission": "read", "reason": "열람 요청"}, 202)
	var tagged int
	if e := s.DB.QueryRow(ctx, "SELECT count(*) FROM notifications WHERE user_id=$1 AND mail_event=$2 AND actor_id=$3", adminID, mailEventAccessRequested, editorID).Scan(&tagged); e != nil || tagged != 1 {
		t.Fatalf("access request must tag the owner's notification: %d %v", tagged, e)
	}
	dispatch()
	waitFor(func() bool {
		return countDeliveries("event=$1 AND recipient='admin@example.test' AND status='sent'", mailEventAccessRequested) == 1
	})

	// The administrator sees what left the building, without bodies.
	page := testJSONObject(t, admin.request("GET", "/api/v1/admin/mail/deliveries?limit=10", nil, 200))
	items := page["items"].([]any)
	summary := page["summary"].(map[string]any)["status"].(map[string]any)
	if len(items) != 3 || number(summary, "sent", 0) != 2 || number(summary, "failed", 0) != 1 || strings.Contains(string(jsonValue(page)), "SECRET_BODY_MARKER") {
		t.Fatalf("delivery log: %s", jsonValue(page))
	}
	failed := testJSONObject(t, admin.request("GET", "/api/v1/admin/mail/deliveries?status=failed", nil, 200))
	if len(failed["items"].([]any)) != 1 {
		t.Fatal("status filter")
	}
	admin.request("GET", "/api/v1/admin/mail/deliveries?status=bogus", nil, 400)
	requester.request("GET", "/api/v1/admin/mail/deliveries", nil, 403)

	// Test send uses the saved settings and reports the verdict inline.
	result := testJSONObject(t, admin.request("POST", "/api/v1/admin/mail/test", map[string]any{"recipient": ""}, 200))
	if result["sent"] != true || str(result, "recipient") != "admin@example.test" || countDeliveries("event='test' AND status='sent'") != 1 {
		t.Fatalf("test send: %v", result)
	}
	admin.request("POST", "/api/v1/admin/mail/test", map[string]any{"recipient": "not-an-address"}, 400)
	recorder.fail("ops@example.test")
	var problem map[string]any
	_ = json.Unmarshal(admin.request("POST", "/api/v1/admin/mail/test", map[string]any{"recipient": "ops@example.test"}, 502), &problem)
	if !strings.Contains(str(problem, "error"), "550") || countDeliveries("event='test' AND status='failed'") != 1 {
		t.Fatalf("failed test send must explain and be recorded: %v", problem)
	}
	// Switching mail off leaves the test button usable but stops events.
	admin.request("PUT", "/api/v1/admin/settings", map[string]any{"mail.enabled": false}, 200)
	recorder.fail("")
	admin.request("POST", "/api/v1/admin/mail/test", map[string]any{"recipient": "ops@example.test"}, 200)
	before := countDeliveries("true")
	insert(editorID, adminID, mailEventApprovalRequested, "꺼진 뒤 요청", "")
	dispatch()
	if countDeliveries("true") != before {
		t.Fatal("events must stop as soon as mail is switched off")
	}
}
