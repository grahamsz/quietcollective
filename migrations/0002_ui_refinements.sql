PRAGMA foreign_keys = ON;

ALTER TABLE galleries ADD COLUMN cover_work_id TEXT REFERENCES works(id) ON DELETE SET NULL;
ALTER TABLE galleries ADD COLUMN cover_version_id TEXT REFERENCES work_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_gallery_pins (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  pinned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, gallery_id)
);

INSERT OR IGNORE INTO instance_settings (key, value_json, description, created_at, updated_at)
VALUES
  ('logo_r2_key', '{"value":null}', 'Optional custom instance logo stored in private R2.', datetime('now'), datetime('now')),
  ('logo_content_type', '{"value":null}', 'Content type for the custom instance logo.', datetime('now'), datetime('now'));

CREATE INDEX IF NOT EXISTS idx_user_gallery_pins_user ON user_gallery_pins(user_id, sort_order, pinned_at);
CREATE INDEX IF NOT EXISTS idx_user_gallery_pins_gallery ON user_gallery_pins(gallery_id);
CREATE INDEX IF NOT EXISTS idx_galleries_cover_work ON galleries(cover_work_id);
CREATE INDEX IF NOT EXISTS idx_galleries_cover_version ON galleries(cover_version_id);
