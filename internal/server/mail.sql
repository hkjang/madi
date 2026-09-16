-- Event mail through the company SMTP relay (MAIL-STANDARD). The in-app
-- notification row is the event: sites that people actually wait on tag it
-- with mail_event and the actor, and a trigger copies it to the outbox so
-- nothing is mailed for a rolled-back request.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mail_event text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id uuid;
CREATE TABLE IF NOT EXISTS mail_outbox(notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,processed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS mail_outbox_pending_idx ON mail_outbox(created_at) WHERE processed_at IS NULL;
CREATE OR REPLACE FUNCTION madi_mail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF coalesce(NEW.mail_event,'')<>'' THEN INSERT INTO mail_outbox(notification_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS madi_mail_notification_created ON notifications;
CREATE TRIGGER madi_mail_notification_created AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION madi_mail_outbox();
-- Every attempt is recorded (subject and recipient only, never the body) so an
-- administrator can answer "it never arrived".
CREATE TABLE IF NOT EXISTS mail_deliveries(
 id uuid PRIMARY KEY,event text NOT NULL,recipient text NOT NULL,subject text NOT NULL,user_id uuid REFERENCES users(id) ON DELETE SET NULL,actor_id uuid,document_id uuid,
 notifications integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed')),attempts integer NOT NULL DEFAULT 0,error_message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_deliveries_created_idx ON mail_deliveries(created_at DESC);
