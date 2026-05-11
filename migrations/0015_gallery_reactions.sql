PRAGMA foreign_keys = ON;

CREATE TABLE reactions_v2 (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('work', 'comment', 'gallery')),
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL DEFAULT 'heart',
  created_at TEXT NOT NULL,
  UNIQUE(target_type, target_id, user_id, reaction)
);

INSERT OR IGNORE INTO reactions_v2 (id, target_type, target_id, user_id, reaction, created_at)
SELECT id, target_type, target_id, user_id, reaction, created_at
FROM reactions;

DROP TABLE reactions;
ALTER TABLE reactions_v2 RENAME TO reactions;

CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id, reaction);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id, created_at);
