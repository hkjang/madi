package server

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestBrowserDatabaseEditing(t *testing.T) {
	if os.Getenv("MADI_BROWSER_DATABASE_EDITING") != "1" {
		t.Skip("set MADI_BROWSER_DATABASE_EDITING=1 after web build")
	}
	seed, _ := integrationTestServer(t)
	app, e := New(t.Context(), seed.DB, seed.EncryptionKey, "0.1.0", "admin@example.test", "Integration-Test-Password-2026!", os.DirFS("../../web/dist"))
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(app)
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 180*time.Second)
	defer cancel()
	outDir, e := filepath.Abs("../../test-results/database-editing")
	if e != nil {
		t.Fatal(e)
	}
	cmd := exec.CommandContext(ctx, "node", "../../tests/database-editing.mjs")
	cmd.Env = append(os.Environ(), "MADI_BASE_URL="+server.URL, "MADI_SCREENSHOT_DIR="+outDir)
	out, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("database editing browser %v\n%s", e, out)
	}
	t.Log(string(out))
	if os.Getenv("MADI_BROWSER_DATABASE_BASELINE") == "1" {
		baseline := exec.CommandContext(ctx, "node", "../../tests/database-advanced.mjs")
		baseline.Env = append(os.Environ(), "MADI_BASE_URL="+server.URL, "MADI_SCREENSHOT_DIR="+filepath.Join(outDir, "baseline"), "MADI_TEST_PASSWORD=Integration-Test-Password-2026!")
		output, err := baseline.CombinedOutput()
		if err != nil {
			t.Fatalf("database baseline browser %v\n%s", err, output)
		}
		t.Log(string(output))
	}
}
