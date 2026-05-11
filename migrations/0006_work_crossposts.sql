CREATE TABLE IF NOT EXISTS work_galleries (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, gallery_id)
);

INSERT OR IGNORE INTO work_galleries (work_id, gallery_id, added_by, created_at, updated_at)
SELECT id, gallery_id, created_by, created_at, updated_at
FROM works;

CREATE INDEX IF NOT EXISTS idx_work_galleries_gallery ON work_galleries(gallery_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_galleries_work ON work_galleries(work_id, updated_at);
