CREATE TABLE IF NOT EXISTS tag_index (
  tag TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('gallery', 'work', 'comment', 'user')),
  target_id TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tag, target_type, target_id, source)
);

CREATE INDEX IF NOT EXISTS idx_tag_index_lookup
  ON tag_index(tag, target_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tag_index_target
  ON tag_index(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_tag_index_recent
  ON tag_index(updated_at DESC);
