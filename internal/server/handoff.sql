CREATE TABLE IF NOT EXISTS handoff_claims (
 claim_hash text PRIMARY KEY,
 document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 format text NOT NULL,
 filename text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 used_at timestamptz
);
CREATE INDEX IF NOT EXISTS handoff_claims_expires_idx ON handoff_claims(expires_at);
