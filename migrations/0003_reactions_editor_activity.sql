PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN last_active_at TEXT;

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('work', 'comment')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL DEFAULT 'heart',
  created_at TEXT NOT NULL,
  UNIQUE(target_type, target_id, user_id, reaction)
);

CREATE TABLE IF NOT EXISTS feedback_request_dismissals (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (work_id, user_id)
);

CREATE TABLE IF NOT EXISTS markdown_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  original_filename TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id, reaction);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_dismissals_user ON feedback_request_dismissals(user_id, dismissed_at);
CREATE INDEX IF NOT EXISTS idx_markdown_assets_owner ON markdown_assets(owner_user_id, created_at);
