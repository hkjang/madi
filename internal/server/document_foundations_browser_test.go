package server

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestBrowserDocumentFoundations(t *testing.T) {
	if os.Getenv("MADI_BROWSER_FOUNDATIONS") != "1" {
		t.Skip("set MADI_BROWSER_FOUNDATIONS=1 after web build")
	}
	seed, _ := integrationTestServer(t)
	app, err := New(context.Background(), seed.DB, seed.EncryptionKey, "0.1.0", "admin@example.test", "Integration-Test-Password-2026!", os.DirFS("../../web/dist"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(app)
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 180*time.Second)
	defer cancel()
	app.StartJobs(ctx)
	command := exec.CommandContext(ctx, "node", "../../tests/document-foundations.mjs")
	command.Env = append(os.Environ(), "MADI_BASE_URL="+server.URL, "MADI_ADMIN_PASSWORD=Integration-Test-Password-2026!")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("foundations browser %v\n%s", err, output)
	}
	t.Log(string(output))
}
