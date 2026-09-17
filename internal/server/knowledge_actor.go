package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Short commit/read backstop. Call after resource locks, never across provider
// network calls. It does not itself authorize a document or grant tool rights.
func (s *Server) knowledgeActorTx(r *http.Request, tx pgx.Tx, wid string, scopes ...string) error {
	p := current(r)
	changed := errors.New("현재 계정·세션·키·워크스페이스 권한이 변경되었습니다")
	if p == nil || p.PluginID != "" || !validID(wid) || p.WorkspaceID != "" && p.WorkspaceID != wid {
		return changed
	}
	for _, scope := range scopes {
		if !hasIntegrationScope(p, scope) {
			return changed
		}
	}
	var role, member string
	var expires time.Time
	if tx.QueryRow(r.Context(), `SELECT role FROM users WHERE id=$1 AND NOT disabled FOR SHARE`, p.ID).Scan(&role) != nil {
		return changed
	}
	if tx.QueryRow(r.Context(), `SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR SHARE`, wid, p.ID).Scan(&member) != nil {
		return changed
	}
	if (slices.Contains(scopes, "document:write") || slices.Contains(scopes, "database:write")) && (role == "viewer" || !oneOf(member, "owner", "admin", "editor")) {
		return changed
	}
	if p.TokenID == "" && p.OAuthSubject == "" {
		cookie, e := r.Cookie("madi_session")
		if e != nil {
			return changed
		}
		if tx.QueryRow(r.Context(), `SELECT expires_at FROM sessions WHERE user_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR SHARE`, p.ID, digest(cookie.Value)).Scan(&expires) != nil {
			return changed
		}
	} else if p.TokenID == "" {
		// An SSO subject is re-verified from the same bearer token against the
		// settings locked in this transaction, exactly as a key is re-read.
		parts := strings.Fields(r.Header.Get("Authorization"))
		var raw []byte
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || tx.QueryRow(r.Context(), `SELECT data FROM settings WHERE id=1 FOR SHARE`).Scan(&raw) != nil {
			return changed
		}
		cfg, e := s.decodeSettings(raw)
		if e != nil {
			return changed
		}
		fresh, until, e := s.mcpOAuthPrincipal(r, cfg, parts[1])
		if e != nil || fresh.ID != p.ID || fresh.OAuthSubject != p.OAuthSubject {
			return changed
		}
		for _, scope := range scopes {
			if !hasIntegrationScope(fresh, scope) {
				return changed
			}
		}
		expires = until
	} else {
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return changed
		}
		var hash string
		var keys, ips []string
		if tx.QueryRow(r.Context(), `SELECT token_hash,scopes,ip_allowlist,expires_at FROM api_keys WHERE id=$1 AND user_id=$2 AND workspace_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`, p.TokenID, p.ID, wid).Scan(&hash, &keys, &ips, &expires) != nil || hash != integrationHash(parts[1]) || !integrationIPAllowed(integrationClientIP(r), ips) {
			return changed
		}
		var raw []byte
		var cfg map[string]any
		if tx.QueryRow(r.Context(), `SELECT data FROM settings WHERE id=1 FOR SHARE`).Scan(&raw) != nil || json.Unmarshal(raw, &cfg) != nil {
			return changed
		}
		allowed := settingStrings(cfg, "allowed_key_scopes", keyScopes)
		for _, scope := range scopes {
			if !slices.Contains(keys, scope) || !slices.Contains(allowed, scope) {
				return changed
			}
		}
	}
	// A row-lock wait can finish after its WHERE expression was evaluated.
	if !expires.After(time.Now()) {
		return changed
	}
	return nil
}
