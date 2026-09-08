package server

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in because pg_dump/pg_restore and CREATE DATABASE are additional operational
// prerequisites. Every database mutated or dropped below is freshly generated.
func TestNativeBackupCurrentFullSchema(t *testing.T) {
	if os.Getenv("MADI_NATIVE_BACKUP_FULL") != "1" {
		t.Skip("MADI_NATIVE_BACKUP_FULL=1 enables isolated native full-schema restore")
	}
	dsn := os.Getenv("MADI_TEST_POSTGRES_DSN")
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || !strings.HasSuffix(u.Path, "_test") {
		t.Fatal("An explicit disposable PostgreSQL URI ending in _test is required")
	}
	for _, command := range []string{"bash", "pg_dump", "pg_restore", "psql", "tar", "sha256sum"} {
		if _, err := exec.LookPath(command); err != nil {
			t.Fatalf("required operational tool unavailable: %s", command)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	stamp := strings.ReplaceAll(newID(), "-", "")[:16]
	sourceName, targetName := "madi_native_"+stamp, "madi_native_"+stamp+"_restore_test"
	for _, name := range []string{sourceName, targetName} {
		if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			cleanup, stop := context.WithTimeout(context.Background(), 30*time.Second)
			defer stop()
			if _, err := admin.Exec(cleanup, "DROP DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
				t.Errorf("cleanup of this test's database %s failed: %v", name, err)
			}
		})
	}
	databaseURL := func(name string, password bool) string {
		copyURL := *u
		copyURL.Path = "/" + name
		if !password {
			copyURL.User = url.User(u.User.Username())
		}
		return copyURL.String()
	}
	source, err := pgxpool.New(ctx, databaseURL(sourceName, true))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(source.Close)
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	versionBytes, err := os.ReadFile(filepath.Join(root, "VERSION"))
	if err != nil {
		t.Fatal(err)
	}
	version := strings.TrimSpace(string(versionBytes))
	key := bytes.Repeat([]byte{42}, 32)
	s, err := New(ctx, source, key, version, "admin@example.test", "Native-Backup-Password-2026!", fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("madi")}})
	if err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	attachments := filepath.Join(temp, "source")
	if err := os.Mkdir(attachments, 0700); err != nil {
		t.Fatal(err)
	}
	attachmentID := newID()
	attachmentBytes := []byte("실제 전체 스키마 운영 백업 첨부\n")
	if err := os.WriteFile(filepath.Join(attachments, attachmentID), attachmentBytes, 0600); err != nil {
		t.Fatal(err)
	}
	var documentID, actorID, originalMarkdown string
	if err := source.QueryRow(ctx, "SELECT id::text,owner_id::text,markdown FROM documents LIMIT 1").Scan(&documentID, &actorID, &originalMarkdown); err != nil {
		t.Fatal(err)
	}
	ciphertext, err := s.encrypt("native-fixture-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(ctx, "INSERT INTO attachments(id,document_id,user_id,name,content_type,size,path) VALUES($1,$2,$3,'fixture.txt','text/plain',$4,$5)", attachmentID, documentID, actorID, len(attachmentBytes), filepath.Join(attachments, attachmentID)); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(ctx, "UPDATE settings SET data=data||jsonb_build_object('storage_path',$1::text,'native_test_secret',$2::text,'support_enabled',true,'otel_enabled',true) WHERE id=1", attachments, ciphertext); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('native-test-cookie',$1,now()+interval '1 hour');`, actorID); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(ctx, `UPDATE job_settings SET paused=false;
UPDATE connector_settings SET enabled=true;
UPDATE notification_settings SET enabled=true;
UPDATE inbound_capture_settings SET hooks_enabled=true,imap_enabled=true;
UPDATE runbook_settings SET enabled=true;
UPDATE export_settings SET enabled=true;
UPDATE protection_settings SET data=data||'{"public_shares_enabled":true}'::jsonb;
UPDATE git_sync_settings SET data=data||'{"enabled":true}'::jsonb;`); err != nil {
		t.Fatal(err)
	}
	environment := os.Environ()
	if password, ok := u.User.Password(); ok {
		escape := strings.NewReplacer("\\", "\\\\", ":", "\\:").Replace
		port := u.Port()
		if port == "" {
			port = "5432"
		}
		passfile := filepath.Join(temp, "pgpass")
		line := escape(u.Hostname()) + ":" + port + ":*:" + escape(u.User.Username()) + ":" + escape(password) + "\n"
		if err := os.WriteFile(passfile, []byte(line), 0600); err != nil {
			t.Fatal(err)
		}
		environment = append(environment, "PGPASSFILE="+passfile)
	}
	run := func(script string, args ...string) {
		t.Helper()
		command := exec.CommandContext(ctx, "bash", append([]string{filepath.Join(root, "scripts", script)}, args...)...)
		command.Dir, command.Env = root, environment
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("%s failed: %v\n%s", script, err, output)
		}
	}
	backup, restored := filepath.Join(temp, "backup"), filepath.Join(temp, "restored")
	run("backup-postgres.sh", "--dsn", databaseURL(sourceName, false), "--attachments", attachments, "--output", backup, "--acknowledge", "WRITES_STOPPED")
	run("restore-postgres.sh", "--backup", backup, "--target-dsn", databaseURL(targetName, false), "--attachments", restored, "--acknowledge", "RESTORE_DISPOSABLE_TARGET")
	target, err := pgxpool.New(ctx, databaseURL(targetName, true))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(target.Close)
	var valid bool
	if err := target.QueryRow(ctx, `SELECT
(SELECT count(*)=0 FROM sessions) AND (SELECT paused FROM job_settings WHERE id=1)
AND (SELECT NOT enabled FROM connector_settings WHERE id=1)
AND (SELECT NOT enabled FROM notification_settings WHERE id=1)
AND (SELECT NOT hooks_enabled AND NOT imap_enabled FROM inbound_capture_settings WHERE id=1)
AND (SELECT NOT enabled FROM runbook_settings WHERE id=1)
AND (SELECT NOT enabled FROM export_settings WHERE id=true)
AND (SELECT NOT (data->>'public_shares_enabled')::boolean FROM protection_settings WHERE id=1)
AND (SELECT NOT (data->>'enabled')::boolean FROM git_sync_settings WHERE id=1)
AND (SELECT NOT (data->>'support_enabled')::boolean AND NOT (data->>'otel_enabled')::boolean AND data->>'storage_path'=$1 FROM settings WHERE id=1)
AND EXISTS(SELECT 1 FROM search_index_queue WHERE document_id=$2)
AND (SELECT markdown=$3 FROM documents WHERE id=$2)
AND (SELECT path=$4 FROM attachments WHERE id=$5)`, restored, documentID, originalMarkdown, filepath.Join(restored, attachmentID), attachmentID).Scan(&valid); err != nil || !valid {
		t.Fatalf("restored full-schema data/safety checks: valid=%v err=%v", valid, err)
	}
	var restoredCipher string
	if err := target.QueryRow(ctx, "SELECT data->>'native_test_secret' FROM settings WHERE id=1").Scan(&restoredCipher); err != nil {
		t.Fatal(err)
	}
	if plain, err := s.decrypt(restoredCipher); err != nil || plain != "native-fixture-secret" || restoredCipher != ciphertext {
		t.Fatal("encrypted configuration did not survive native restore")
	}
	if actual, err := os.ReadFile(filepath.Join(restored, attachmentID)); err != nil || !bytes.Equal(actual, attachmentBytes) {
		t.Fatal("attachment bytes did not survive native restore")
	}
	t.Log("Current complete schema, encrypted settings, Markdown and attachment bytes restored; external execution policies disabled; disposable databases removed on cleanup")
}
