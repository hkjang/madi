package server

import (
	"os"
	"os/exec"
	"testing"
)

// The policy is enforced by the browser, so the nonce, the same-origin proxy
// and the violation report are checked in a real Chromium against the fixture.
func TestBrowserTrackingSnippetUnderPolicy(t *testing.T) {
	if os.Getenv("MADI_BROWSER_TRACKING") != "1" {
		t.Skip("MADI_BROWSER_TRACKING=1 enables real browser tracking CSP validation")
	}
	_, server := integrationTestServer(t)
	cmd := exec.CommandContext(t.Context(), "node", "../../tests/tracking-browser.mjs")
	cmd.Env = append(os.Environ(), "MADI_BASE_URL="+server.URL)
	output, e := cmd.CombinedOutput()
	if e != nil {
		t.Fatalf("tracking browser: %v\n%s", e, output)
	}
	t.Log(string(output))
}
