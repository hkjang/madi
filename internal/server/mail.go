package server

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"math"
	"mime"
	"net"
	"net/smtp"
	"net/url"
	"strings"
	"time"
)

// Event mail follows MAIL-STANDARD: an internal relay on port 25 with no
// credentials and no TLS is the common case, so authentication and encryption
// are optional and the transport adapts to what the server advertises.
// Settings keys are shared with every other service (mail.enabled, ...).
const (
	mailEventApprovalRequested = "approval.requested"
	mailEventApprovalDecided   = "approval.decided"
	mailEventAccessRequested   = "access_request.created"
	mailEventAccessDecided     = "access_request.decided"
	mailEventTaskAssigned      = "task.assigned"
	mailEventRunbookFinished   = "runbook.finished"
	mailEventReviewDue         = "document.review_due"
	mailEventTest              = "test"
)

// mailEventSettings maps an event to the switch an administrator can turn off.
// Both access-request directions share one switch, as in the reference.
var mailEventSettings = map[string]string{
	mailEventApprovalRequested: "mail.notify_approval_request",
	mailEventApprovalDecided:   "mail.notify_approval_decision",
	mailEventAccessRequested:   "mail.notify_access_request",
	mailEventAccessDecided:     "mail.notify_access_request",
	mailEventTaskAssigned:      "mail.notify_task_assigned",
	mailEventRunbookFinished:   "mail.notify_runbook",
	mailEventReviewDue:         "mail.notify_review_due",
}

// mailEventCopy is the subject and the screen a recipient opens for each event.
var mailEventCopy = map[string]struct{ subject, path string }{
	mailEventApprovalRequested: {"검토 요청이 도착했습니다", "/app/approvals"},
	mailEventApprovalDecided:   {"검토 결과가 나왔습니다", "/app/approvals"},
	mailEventAccessRequested:   {"문서 접근 권한 요청이 도착했습니다", "/app/access-requests"},
	mailEventAccessDecided:     {"문서 접근 권한 요청이 처리되었습니다", "/app/access-requests"},
	mailEventTaskAssigned:      {"담당할 할 일이 지정되었습니다", "/app/tasks"},
	mailEventRunbookFinished:   {"격리 작업이 끝났습니다", "/app/inbox"},
	mailEventReviewDue:         {"검토 주기가 지난 문서가 있습니다", "/app/knowledge-time"},
	mailEventTest:              {"SMTP 발송 테스트", ""},
}

var errMailInvalid = errors.New("메일 설정이 올바르지 않습니다")

func defaultMailSettings() map[string]any {
	out := map[string]any{
		"mail.enabled": false, "mail.smtp_host": "", "mail.smtp_port": 25, "mail.security": "auto", "mail.skip_tls_verify": false,
		"mail.username": "", "mail.password": "", "mail.from_address": "", "mail.from_name": "", "mail.base_url": "", "mail.timeout_seconds": 10,
	}
	for _, key := range mailEventSettings {
		out[key] = true
	}
	return out
}

type mailConfig struct {
	Enabled     bool
	Host        string
	Port        int
	Security    string
	SkipVerify  bool
	Username    string
	Password    string
	FromAddress string
	FromName    string
	BaseURL     string
	SiteName    string
	Timeout     time.Duration
	Events      map[string]bool
}

// mailConfigFrom reads the effective relay configuration from the decoded
// settings map. The sender falls back to madi@<relay> and links fall back to
// the service URL so a bare relay address is enough to get started.
func mailConfigFrom(cfg map[string]any) mailConfig {
	out := mailConfig{Enabled: boolean(cfg, "mail.enabled"), Host: strings.TrimSpace(str(cfg, "mail.smtp_host")), Port: number(cfg, "mail.smtp_port", 25),
		Security: strings.ToLower(strings.TrimSpace(str(cfg, "mail.security"))), SkipVerify: boolean(cfg, "mail.skip_tls_verify"), Username: strings.TrimSpace(str(cfg, "mail.username")), Password: str(cfg, "mail.password"),
		FromAddress: strings.TrimSpace(str(cfg, "mail.from_address")), FromName: strings.TrimSpace(str(cfg, "mail.from_name")), BaseURL: strings.TrimRight(strings.TrimSpace(str(cfg, "mail.base_url")), "/"),
		SiteName: strings.TrimSpace(str(cfg, "site_name")), Timeout: time.Duration(number(cfg, "mail.timeout_seconds", 10)) * time.Second, Events: map[string]bool{}}
	if out.Security == "" {
		out.Security = "auto"
	}
	// A relay on the implicit TLS port needs no extra configuration.
	if out.Security == "auto" && out.Port == 465 {
		out.Security = "tls"
	}
	if out.Timeout <= 0 {
		out.Timeout = 10 * time.Second
	}
	if out.SiteName == "" {
		out.SiteName = "madi"
	}
	if out.FromName == "" {
		out.FromName = out.SiteName
	}
	if out.FromAddress == "" && out.Host != "" {
		out.FromAddress = "madi@" + out.Host
	}
	if out.BaseURL == "" {
		out.BaseURL = strings.TrimRight(str(cfg, "site_url"), "/")
	}
	for event, key := range mailEventSettings {
		if enabled, ok := cfg[key].(bool); ok {
			out.Events[event] = enabled
		}
	}
	return out
}

// allows reports whether an event kind should be mailed. Unknown events are
// sent so adding a notification never needs a settings change first.
func (c mailConfig) allows(event string) bool {
	if enabled, known := c.Events[event]; known {
		return enabled
	}
	return true
}

func (c mailConfig) validate() error {
	if c.Host == "" {
		return fmt.Errorf("%w: 릴레이 주소(mail.smtp_host)를 입력하세요", errMailInvalid)
	}
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("%w: 포트는 1~65535 범위입니다", errMailInvalid)
	}
	if !validNotificationAddress(c.FromAddress) {
		return fmt.Errorf("%w: 보내는 주소(mail.from_address)를 확인하세요", errMailInvalid)
	}
	if !oneOf(c.Security, "auto", "none", "starttls", "tls") {
		return fmt.Errorf("%w: 보안 방식은 auto·none·starttls·tls 중 하나입니다", errMailInvalid)
	}
	return nil
}

func (c mailConfig) endpoint() string { return net.JoinHostPort(c.Host, fmt.Sprint(c.Port)) }
func (c mailConfig) tlsConfig() *tls.Config {
	return &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: c.SkipVerify} //nolint:gosec // opt-in for internal relays with private certificates
}

// From is the RFC 5322 sender with a Q-encoded display name.
func (c mailConfig) From() string {
	if c.FromName == "" {
		return c.FromAddress
	}
	return mime.QEncoding.Encode("utf-8", c.FromName) + " <" + c.FromAddress + ">"
}

// link joins a screen path to the configured base URL; an empty base means
// mails carry no links rather than a wrong host.
func (c mailConfig) link(path string) string {
	if c.BaseURL == "" || path == "" {
		return ""
	}
	return c.BaseURL + "/" + strings.TrimLeft(path, "/")
}

// validateMailSettings checks types and ranges on every save and the effective
// relay configuration only once mail is switched on, so an administrator can
// fill the form in several steps.
func validateMailSettings(cfg map[string]any) error {
	for key, initial := range defaultMailSettings() {
		switch initial.(type) {
		case bool:
			if _, ok := cfg[key].(bool); !ok {
				return fmt.Errorf("%s는 true/false여야 합니다", key)
			}
		case string:
			if _, ok := cfg[key].(string); !ok {
				return fmt.Errorf("%s는 문자열이어야 합니다", key)
			}
		case int:
			value, ok := operationNumber(cfg[key])
			if !ok || value != math.Trunc(value) {
				return fmt.Errorf("%s는 정수여야 합니다", key)
			}
		}
	}
	if port := number(cfg, "mail.smtp_port", 0); port < 1 || port > 65535 {
		return errors.New("mail.smtp_port는 1~65535 범위입니다")
	}
	if seconds := number(cfg, "mail.timeout_seconds", 0); seconds < 1 || seconds > 120 {
		return errors.New("mail.timeout_seconds는 1~120초 범위입니다")
	}
	if !oneOf(strings.ToLower(strings.TrimSpace(str(cfg, "mail.security"))), "", "auto", "none", "starttls", "tls") {
		return errors.New("mail.security는 auto·none·starttls·tls 중 하나입니다")
	}
	host := strings.TrimSpace(str(cfg, "mail.smtp_host"))
	if len(host) > 253 || strings.ContainsAny(host, "/:@\\ \t\r\n") {
		return errors.New("mail.smtp_host는 포트·경로 없는 호스트 이름 또는 IP여야 합니다")
	}
	if from := strings.TrimSpace(str(cfg, "mail.from_address")); from != "" && !validNotificationAddress(from) {
		return errors.New("mail.from_address는 이메일 주소여야 합니다")
	}
	for _, key := range []string{"mail.from_name", "mail.username"} {
		if value := str(cfg, key); len(value) > 200 || strings.ContainsAny(value, "\r\n\x00") {
			return fmt.Errorf("%s 형식과 길이를 확인하세요", key)
		}
	}
	if secret := str(cfg, "mail.password"); len(secret) > 1024 || strings.ContainsAny(secret, "\r\n\x00") {
		return errors.New("mail.password 형식과 길이를 확인하세요")
	}
	if base := strings.TrimSpace(str(cfg, "mail.base_url")); base != "" {
		u, e := url.Parse(base)
		if e != nil || u.Host == "" || !oneOf(u.Scheme, "http", "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return errors.New("mail.base_url에 올바른 HTTP(S) URL을 입력하세요")
		}
	}
	if boolean(cfg, "mail.enabled") {
		if e := mailConfigFrom(cfg).validate(); e != nil {
			return e
		}
	}
	return nil
}

type mailMessage struct {
	To      string
	Subject string
	Body    string
}

// mailDeliver opens a connection to the relay and sends one message. Failures
// are returned with a Korean description that never includes credentials.
func mailDeliver(ctx context.Context, cfg mailConfig, message mailMessage) error {
	if e := cfg.validate(); e != nil {
		return e
	}
	if !validNotificationAddress(message.To) {
		return fmt.Errorf("%w: 받는 주소를 확인하세요", errMailInvalid)
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	client, e := mailDial(ctx, cfg)
	if e != nil {
		return e
	}
	defer client.Close()
	if e = mailSession(client, cfg); e != nil {
		return e
	}
	if e = client.Mail(cfg.FromAddress); e != nil {
		return fmt.Errorf("MAIL FROM 거부: %w", e)
	}
	if e = client.Rcpt(message.To); e != nil {
		return fmt.Errorf("RCPT TO 거부: %w", e)
	}
	writer, e := client.Data()
	if e != nil {
		return fmt.Errorf("DATA 실패: %w", e)
	}
	if _, e = writer.Write([]byte(mailCompose(cfg, message))); e != nil {
		return fmt.Errorf("본문 전송 실패: %w", e)
	}
	if e = writer.Close(); e != nil {
		return fmt.Errorf("본문 종료 실패: %w", e)
	}
	return client.Quit()
}

func mailDial(ctx context.Context, cfg mailConfig) (*smtp.Client, error) {
	dialer := &net.Dialer{Timeout: cfg.Timeout}
	var conn net.Conn
	var e error
	if cfg.Security == "tls" {
		conn, e = (&tls.Dialer{NetDialer: dialer, Config: cfg.tlsConfig()}).DialContext(ctx, "tcp", cfg.endpoint())
	} else {
		conn, e = dialer.DialContext(ctx, "tcp", cfg.endpoint())
	}
	if e != nil {
		return nil, fmt.Errorf("SMTP 연결 실패: %w", e)
	}
	deadline := time.Now().Add(cfg.Timeout)
	if when, ok := ctx.Deadline(); ok && when.Before(deadline) {
		deadline = when
	}
	_ = conn.SetDeadline(deadline)
	client, e := smtp.NewClient(conn, cfg.Host)
	if e != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("SMTP 세션 시작 실패: %w", e)
	}
	return client, nil
}

// mailSession upgrades and authenticates only as far as the relay allows, so
// an unauthenticated internal relay works with the same settings as a hosted
// provider that demands both.
func mailSession(client *smtp.Client, cfg mailConfig) error {
	if e := client.Hello(mailHelloName(cfg)); e != nil {
		return fmt.Errorf("EHLO 실패: %w", e)
	}
	if cfg.Security == "starttls" || cfg.Security == "auto" {
		if supported, _ := client.Extension("STARTTLS"); supported {
			if e := client.StartTLS(cfg.tlsConfig()); e != nil {
				return fmt.Errorf("STARTTLS 실패: %w", e)
			}
		} else if cfg.Security == "starttls" {
			return fmt.Errorf("%w: 서버가 STARTTLS를 지원하지 않습니다", errMailInvalid)
		}
	}
	if cfg.Username == "" {
		return nil
	}
	supported, mechanisms := client.Extension("AUTH")
	if !supported {
		return fmt.Errorf("%w: 서버가 인증을 지원하지 않습니다. 사용자 이름을 비우고 사용하세요", errMailInvalid)
	}
	var auth smtp.Auth
	switch {
	case strings.Contains(strings.ToUpper(mechanisms), "PLAIN"):
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	case strings.Contains(strings.ToUpper(mechanisms), "LOGIN"):
		auth = mailLoginAuth{username: cfg.Username, password: cfg.Password, host: cfg.Host}
	default:
		auth = smtp.CRAMMD5Auth(cfg.Username, cfg.Password)
	}
	if e := client.Auth(auth); e != nil {
		return fmt.Errorf("SMTP 인증 실패: %w", e)
	}
	return nil
}

// mailHelloName keeps the EHLO name to the sender domain, which relays that
// check the greeting accept more readily than a container hostname.
func mailHelloName(cfg mailConfig) string {
	if at := strings.LastIndex(cfg.FromAddress, "@"); at >= 0 && at+1 < len(cfg.FromAddress) {
		return cfg.FromAddress[at+1:]
	}
	return "localhost"
}

// mailLoginAuth implements the LOGIN mechanism several corporate relays use
// instead of PLAIN. The standard library ships only PLAIN and CRAM-MD5.
type mailLoginAuth struct{ username, password, host string }

func (a mailLoginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && server.Name != a.host {
		return "", nil, errors.New("LOGIN 인증은 신뢰할 수 있는 서버에서만 사용합니다")
	}
	return "LOGIN", nil, nil
}
func (a mailLoginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimRight(string(fromServer), ": ")) {
	case "username":
		return []byte(a.username), nil
	case "password":
		return []byte(a.password), nil
	}
	return nil, fmt.Errorf("알 수 없는 LOGIN 요청: %s", fromServer)
}

// mailCompose builds a plain-text MIME message. Korean subjects are encoded so
// relays and clients that predate UTF-8 headers still show them correctly.
func mailCompose(cfg mailConfig, message mailMessage) string {
	var b strings.Builder
	b.WriteString("From: " + cfg.From() + "\r\n")
	b.WriteString("To: " + message.To + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", message.Subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("Message-ID: <" + newID() + "@madi>\r\n")
	b.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\nAuto-Submitted: auto-generated\r\nX-Madi-Notification: 1\r\n\r\n")
	b.WriteString(mailBody(message.Body))
	return b.String()
}

// mailBody uses CRLF line endings and escapes leading dots so a line of text
// can never terminate the DATA command early.
func mailBody(body string) string {
	body = strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n")
	if strings.HasPrefix(body, ".") {
		body = "." + body
	}
	body = strings.ReplaceAll(body, "\r\n.", "\r\n..")
	if !strings.HasSuffix(body, "\r\n") {
		body += "\r\n"
	}
	return body
}

// mailNotice is one event mail before it is addressed: a subject line and the
// notification titles it bundles, each with an optional document link.
type mailNotice struct {
	Event string
	Items []mailNoticeItem
}
type mailNoticeItem struct{ Title, DocumentID string }

func (n mailNotice) subject(cfg mailConfig) string {
	subject := mailEventCopy[n.Event].subject
	if subject == "" {
		subject = "새 알림"
	}
	if len(n.Items) > 1 {
		subject += fmt.Sprintf(" (%d건)", len(n.Items))
	}
	return "[" + cfg.SiteName + "] " + subject
}

// render writes the body: one line per bundled notification, the screen to
// open, and a footer that says why the mail arrived.
func (n mailNotice) render(cfg mailConfig) string {
	lines := []string{}
	if n.Event == mailEventTest {
		lines = append(lines, cfg.SiteName+" 관리자 화면에서 보낸 테스트 메일입니다.", "이 메일을 받았다면 SMTP 릴레이 설정이 정상입니다.")
	} else {
		lines = append(lines, fmt.Sprintf("%s에서 기다리시는 일이 %d건 있습니다.", cfg.SiteName, len(n.Items)), "")
		for _, item := range n.Items {
			lines = append(lines, "- "+strings.TrimSpace(item.Title))
			if link := cfg.link("/app/documents/" + item.DocumentID); item.DocumentID != "" && link != "" {
				lines = append(lines, "  "+link)
			}
		}
		if link := cfg.link(mailEventCopy[n.Event].path); link != "" {
			lines = append(lines, "", "바로 열기: "+link)
		} else if link := cfg.link("/app/inbox"); link != "" {
			lines = append(lines, "", "바로 열기: "+link)
		}
	}
	lines = append(lines, "", "—", "이 메일은 "+cfg.SiteName+" 메일 알림 설정에 따라 자동으로 발송되었습니다. 종류별 수신 여부는 서비스 관리자가 설정합니다.")
	return strings.Join(lines, "\n")
}
