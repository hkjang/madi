package server

import (
	"context"
	_ "embed"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:embed mail.sql
var mailSchema string

func (s *Server) migrateMail(ctx context.Context) error {
	_, e := s.DB.Exec(ctx, mailSchema)
	return e
}

// StartMail drains the mail outbox on the same cadence as the other
// dispatchers. Requests never wait on the relay: they only insert the
// notification row, and this loop does the sending afterwards.
func (s *Server) StartMail(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			if e := s.dispatchMail(ctx); e != nil && ctx.Err() == nil {
				slog.Error("mail dispatcher failed", "error", e)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

type mailDelivery struct {
	ID, Event, Recipient, Subject, UserID, ActorID, DocumentID string
	Count                                                      int
}

type mailPending struct {
	notificationID, userID, event, title, documentID, actorID, email string
	eligible                                                         bool
}

// dispatchMail claims pending outbox rows, bundles them into one mail per
// recipient and event, records each delivery as queued and hands the sending
// to the background. Rows are marked processed even when mail is off, so
// switching it on later never releases a backlog of stale notifications.
func (s *Server) dispatchMail(ctx context.Context) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, `SELECT o.notification_id::text,n.user_id::text,coalesce(n.mail_event,''),n.title,coalesce(n.document_id::text,''),coalesce(n.actor_id::text,''),u.email,
 NOT u.disabled AND u.kind='user' AND n.read_at IS NULL AND (n.document_id IS NULL OR madi_document_allowed(n.user_id,n.document_id,false))
 FROM mail_outbox o JOIN notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.user_id WHERE o.processed_at IS NULL ORDER BY o.created_at,o.notification_id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`)
	if e != nil {
		return e
	}
	pending := []mailPending{}
	for rows.Next() {
		var p mailPending
		if e = rows.Scan(&p.notificationID, &p.userID, &p.event, &p.title, &p.documentID, &p.actorID, &p.email, &p.eligible); e != nil {
			rows.Close()
			return e
		}
		pending = append(pending, p)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if len(pending) == 0 {
		return tx.Commit(ctx)
	}
	settings, e := s.settings(ctx)
	if e != nil {
		return e
	}
	cfg := mailConfigFrom(settings)
	ids := make([]string, 0, len(pending))
	for _, p := range pending {
		ids = append(ids, p.notificationID)
	}
	if _, e = tx.Exec(ctx, "UPDATE mail_outbox SET processed_at=now() WHERE notification_id=ANY($1::uuid[])", ids); e != nil {
		return e
	}
	type bundle struct {
		delivery mailDelivery
		notice   mailNotice
	}
	bundles := []*bundle{}
	if cfg.Enabled && cfg.validate() == nil {
		index := map[string]*bundle{}
		for _, p := range pending {
			// Nobody is told about their own action, and only events the
			// administrator left on go out.
			if !p.eligible || !cfg.allows(p.event) || p.actorID == p.userID || !validNotificationAddress(p.email) {
				continue
			}
			key := p.userID + "\n" + p.event
			b, ok := index[key]
			if !ok {
				b = &bundle{delivery: mailDelivery{ID: newID(), Event: p.event, Recipient: p.email, UserID: p.userID, ActorID: p.actorID, DocumentID: p.documentID}, notice: mailNotice{Event: p.event}}
				index[key] = b
				bundles = append(bundles, b)
			}
			b.notice.Items = append(b.notice.Items, mailNoticeItem{Title: p.title, DocumentID: p.documentID})
			if b.delivery.DocumentID != p.documentID {
				b.delivery.DocumentID = ""
			}
		}
		for _, b := range bundles {
			b.delivery.Subject = b.notice.subject(cfg)
			b.delivery.Count = len(b.notice.Items)
			if _, e = tx.Exec(ctx, `INSERT INTO mail_deliveries(id,event,recipient,subject,user_id,actor_id,document_id,notifications) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid,NULLIF($7,'')::uuid,$8)`,
				b.delivery.ID, b.delivery.Event, b.delivery.Recipient, b.delivery.Subject, b.delivery.UserID, b.delivery.ActorID, b.delivery.DocumentID, b.delivery.Count); e != nil {
				return e
			}
		}
	} else if cfg.Enabled {
		slog.Warn("mail is enabled but not configured; notifications were not mailed", "error", cfg.validate(), "notifications", len(pending))
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	for _, b := range bundles {
		go s.deliverMail(b.delivery, cfg, mailMessage{To: b.delivery.Recipient, Subject: b.delivery.Subject, Body: b.notice.render(cfg)})
	}
	return nil
}

// deliverMail retries once, because a relay that briefly refuses a connection
// is common and losing the notification is worse than a short wait.
func (s *Server) deliverMail(delivery mailDelivery, cfg mailConfig, message mailMessage) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*cfg.Timeout+15*time.Second)
	defer cancel()
	var e error
	attempts := 0
	for attempts < 2 {
		attempts++
		if e = s.mailSend(ctx, cfg, message); e == nil {
			break
		}
		if attempts == 1 {
			select {
			case <-ctx.Done():
			case <-time.After(2 * time.Second):
			}
		}
	}
	s.completeMail(ctx, delivery.ID, attempts, e)
}

// completeMail records the outcome. The error text is what the relay said;
// credentials never appear in it because the transport does not echo them.
func (s *Server) completeMail(ctx context.Context, id string, attempts int, cause error) {
	status, message := "sent", ""
	if cause != nil {
		status, message = "failed", cause.Error()
		if len([]rune(message)) > 1000 {
			message = string([]rune(message)[:1000])
		}
		slog.Warn("notification mail failed", "delivery", id, "attempts", attempts, "error", message)
	}
	if _, e := s.DB.Exec(ctx, "UPDATE mail_deliveries SET status=$2,attempts=GREATEST(attempts,$3),error_message=$4,updated_at=now() WHERE id=$1", id, status, attempts, message); e != nil {
		slog.Warn("mail delivery status was not recorded", "error", e)
	}
}

// sendMailNow delivers immediately and reports the outcome, which is what the
// administrator's test button needs. It works while mail is still switched
// off so the relay can be proven before anything depends on it.
func (s *Server) sendMailNow(ctx context.Context, cfg mailConfig, actorID, recipient string, notice mailNotice) error {
	if e := cfg.validate(); e != nil {
		return e
	}
	id, subject := newID(), notice.subject(cfg)
	if _, e := s.DB.Exec(ctx, `INSERT INTO mail_deliveries(id,event,recipient,subject,actor_id,notifications) VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,$6)`, id, notice.Event, recipient, subject, actorID, len(notice.Items)); e != nil {
		return e
	}
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.Timeout+5*time.Second)
	defer cancel()
	e := s.mailSend(sendCtx, cfg, mailMessage{To: recipient, Subject: subject, Body: notice.render(cfg)})
	s.completeMail(sendCtx, id, 1, e)
	return e
}

func (s *Server) registerMail() {
	s.admin("GET /api/v1/admin/mail/deliveries", s.listMailDeliveries)
	s.admin("POST /api/v1/admin/mail/test", s.testMail)
}

// listMailDeliveries shows what left the building, newest first, with a
// status breakdown. Bodies are never stored, so nothing here can leak them.
func (s *Server) listMailDeliveries(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !oneOf(status, "queued", "sent", "failed") {
		apiError(w, 400, "상태는 queued·sent·failed 중 하나입니다")
		return
	}
	items, e := s.rows(r.Context(), `SELECT jsonb_build_object('id',d.id,'event',d.event,'recipient',d.recipient,'subject',d.subject,'user_id',d.user_id,'actor_id',d.actor_id,'actor_name',a.name,'document_id',d.document_id,'notifications',d.notifications,'status',d.status,'attempts',d.attempts,'error_message',d.error_message,'created_at',d.created_at,'updated_at',d.updated_at)
 FROM mail_deliveries d LEFT JOIN users a ON a.id=d.actor_id WHERE $1='' OR d.status=$1 ORDER BY d.created_at DESC,d.id LIMIT $2`, status, limit)
	if e != nil {
		respond(w, nil, e)
		return
	}
	counts, e := s.rows(r.Context(), "SELECT jsonb_build_object('status',status,'count',count(*)) FROM mail_deliveries GROUP BY status")
	if e != nil {
		respond(w, nil, e)
		return
	}
	summary, total := map[string]int{"queued": 0, "sent": 0, "failed": 0}, 0
	for _, row := range counts {
		summary[str(row, "status")] = number(row, "count", 0)
		total += number(row, "count", 0)
	}
	jsonResponse(w, 200, map[string]any{"items": items, "summary": map[string]any{"total": total, "status": summary}})
}

// testMail sends one real message with the saved settings and answers with
// the relay's verdict, because relay settings are rarely right first time.
func (s *Server) testMail(w http.ResponseWriter, r *http.Request) {
	var in struct{ Recipient string }
	if decode(r, &in) != nil {
		apiError(w, 400, "받는 주소를 확인하세요")
		return
	}
	recipient := strings.ToLower(strings.TrimSpace(in.Recipient))
	if recipient == "" {
		recipient = current(r).Email
	}
	if !validNotificationAddress(recipient) {
		apiError(w, 400, "받는 주소는 이메일 형식이어야 합니다")
		return
	}
	settings, e := s.settings(r.Context())
	if e != nil {
		respond(w, nil, e)
		return
	}
	cfg := mailConfigFrom(settings)
	e = s.sendMailNow(r.Context(), cfg, current(r).ID, recipient, mailNotice{Event: mailEventTest, Items: []mailNoticeItem{{Title: "테스트"}}})
	s.audit(r, "MAIL_TEST", recipient, map[string]any{"sent": e == nil})
	if errors.Is(e, errMailInvalid) {
		apiError(w, 400, e.Error())
		return
	}
	if e != nil {
		apiError(w, 502, "시험 발송 실패: "+e.Error())
		return
	}
	jsonResponse(w, 200, map[string]any{"sent": true, "recipient": recipient, "enabled": cfg.Enabled})
}
