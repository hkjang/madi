import assert from "node:assert/strict";
import {
  clearSilentSsoState,
  markSignedOut,
  oidcLoginStartUrl,
  safeReturnTo,
  shouldAttemptSilentSso,
  silentSsoPathAllowed,
  silentSsoStartUrl,
} from "../web/src/auth/silentSso.ts";

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};
const env = (overrides = {}) => ({
  storage: (() => {
    const s = memoryStorage();
    return () => s;
  })(),
  pathname: "/app",
  search: "",
  ...overrides,
});
const enabled = { oidc_enabled: true, oidc_auto_login: true };

// Off by default: neither flag alone is enough.
assert.equal(shouldAttemptSilentSso({}, env()), false);
assert.equal(shouldAttemptSilentSso({ oidc_enabled: true }, env()), false);
assert.equal(
  shouldAttemptSilentSso({ oidc_enabled: false, oidc_auto_login: true }, env()),
  false,
);
assert.equal(shouldAttemptSilentSso({ oidc_enabled: "true", oidc_auto_login: "true" }, env()), false);
assert.equal(shouldAttemptSilentSso(enabled, env()), true);

// One attempt per tab session: starting an attempt marks it, a reload does not retry.
{
  const e = env({ pathname: "/app/documents/abc", search: "?x=1" });
  assert.equal(shouldAttemptSilentSso(enabled, e), true);
  assert.equal(
    silentSsoStartUrl("/app/documents/abc?x=1", e),
    "/api/v1/auth/oidc/start?prompt=none&return_to=%2Fapp%2Fdocuments%2Fabc%3Fx%3D1",
  );
  assert.equal(shouldAttemptSilentSso(enabled, e), false, "no retry after an attempt");
  // A new session lifts the mark; a later expiry may try again once.
  clearSilentSsoState(e);
  assert.equal(shouldAttemptSilentSso(enabled, e), true);
}

// The refusal marker in the URL blocks a retry even with empty storage.
assert.equal(shouldAttemptSilentSso(enabled, env({ search: "?sso=none" })), false);
assert.equal(shouldAttemptSilentSso(enabled, env({ search: "?sso=error" })), false);
assert.equal(shouldAttemptSilentSso(enabled, env({ search: "?sso=none", pathname: "/app" })), false);

// A deliberate sign-out suppresses auto login until a session exists again.
{
  const e = env();
  markSignedOut(e);
  assert.equal(shouldAttemptSilentSso(enabled, e), false);
  clearSilentSsoState(e);
  assert.equal(shouldAttemptSilentSso(enabled, e), true);
}

// Unreadable storage (private mode, blocked site data) counts as "already attempted".
{
  const throwing = () => {
    throw new Error("SecurityError");
  };
  const e = env({ storage: throwing });
  assert.equal(shouldAttemptSilentSso(enabled, e), false);
  // Marking still must not throw.
  assert.doesNotThrow(() => markSignedOut(e));
  assert.doesNotThrow(() => silentSsoStartUrl("/app", e));
}

// Never start from callback, login, or non-browser routes.
for (const path of ["/login", "/login/", "/api/v1/auth/oidc/callback", "/api/v1/auth/oidc/start", "/mcp", "/mcp/sse", "/healthz", "/readyz", "/share/abc"]) {
  assert.equal(silentSsoPathAllowed(path), false, path);
  assert.equal(shouldAttemptSilentSso(enabled, env({ pathname: path })), false, path);
}
for (const path of ["/", "/app", "/app/documents/x", "/admin/settings"]) {
  assert.equal(silentSsoPathAllowed(path), true, path);
}

// return_to stays on this origin.
assert.equal(safeReturnTo("/app/documents/x"), "/app/documents/x");
assert.equal(safeReturnTo("//evil.example/x"), "/app");
assert.equal(safeReturnTo("https://evil.example/x"), "/app");
assert.equal(safeReturnTo(""), "/app");

// The login screen's "회사 계정으로 로그인" link carries the last /app path so a
// visible SSO login lands back where the visitor was. It never asks for a silent
// attempt, and it never sends a target the server would only replace with /app.
assert.equal(
  oidcLoginStartUrl("/app/documents/abc?x=1"),
  "/api/v1/auth/oidc/start?return_to=%2Fapp%2Fdocuments%2Fabc%3Fx%3D1",
);
assert.equal(oidcLoginStartUrl("/app/"), "/api/v1/auth/oidc/start?return_to=%2Fapp%2F");
assert.equal(oidcLoginStartUrl("/app?view=recent"), "/api/v1/auth/oidc/start?return_to=%2Fapp%3Fview%3Drecent");
for (const last of [null, undefined, "", "/app", "/admin/settings", "//evil.test", "https://evil.test/app", "/login", "/apple"]) {
  assert.equal(oidcLoginStartUrl(last), "/api/v1/auth/oidc/start", String(last));
}
for (const last of [null, "", "/app/documents/abc", "/admin/settings", "//evil.test", "https://evil.test/app"]) {
  assert.ok(!oidcLoginStartUrl(last).includes("prompt=none"), `prompt=none for ${last}`);
}
console.log("silent-sso ok");
