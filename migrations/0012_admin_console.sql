PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN force_password_change_at TEXT;

ALTER TABLE invites ADD COLUMN token_ciphertext TEXT;
ALTER TABLE invites ADD COLUMN invite_text TEXT;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS rule_versions (
  id TEXT PRIMARY KEY,
  body_markdown TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  superseded_at TEXT
);

CREATE TABLE IF NOT EXISTS rule_acceptances (
  rule_version_id TEXT NOT NULL REFERENCES rule_versions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (rule_version_id, user_id)
);

UPDATE users
SET password_changed_at = updated_at
WHERE password_changed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash, expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rule_versions_current ON rule_versions(published_at, superseded_at);
CREATE INDEX IF NOT EXISTS idx_rule_acceptances_user ON rule_acceptances(user_id, accepted_at);
