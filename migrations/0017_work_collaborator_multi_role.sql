PRAGMA foreign_keys = ON;

CREATE TABLE work_collaborators_v2 (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  role_suggestion_id TEXT REFERENCES role_suggestions(id) ON DELETE SET NULL,
  role_label TEXT NOT NULL,
  credit_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  can_version INTEGER NOT NULL DEFAULT 0 CHECK (can_version IN (0, 1)),
  can_comment INTEGER NOT NULL DEFAULT 0 CHECK (can_comment IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (display_name <> '' OR user_id IS NOT NULL)
);

INSERT INTO work_collaborators_v2 (
  id,
  work_id,
  display_name,
  user_id,
  role_suggestion_id,
  role_label,
  credit_order,
  notes,
  can_edit,
  can_version,
  can_comment,
  created_by,
  created_at,
  updated_at
)
SELECT
  id,
  work_id,
  display_name,
  user_id,
  role_suggestion_id,
  role_label,
  credit_order,
  notes,
  can_edit,
  can_version,
  can_comment,
  created_by,
  created_at,
  updated_at
FROM work_collaborators;

DROP TABLE work_collaborators;
ALTER TABLE work_collaborators_v2 RENAME TO work_collaborators;

CREATE INDEX IF NOT EXISTS idx_work_collaborators_work ON work_collaborators(work_id, credit_order);
CREATE INDEX IF NOT EXISTS idx_work_collaborators_user ON work_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_work_collaborators_work_user ON work_collaborators(work_id, user_id);
CREATE INDEX IF NOT EXISTS idx_work_collaborators_role ON work_collaborators(role_suggestion_id);
