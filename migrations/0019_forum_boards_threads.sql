PRAGMA foreign_keys = OFF;

CREATE TABLE comments_v2 (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'gallery', 'work', 'version', 'comment', 'thread')),
  target_id TEXT NOT NULL,
  parent_comment_id TEXT REFERENCES comments_v2(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  body_format TEXT NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown', 'plain')),
  annotation_json TEXT CHECK (annotation_json IS NULL OR json_valid(annotation_json)),
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

INSERT INTO comments_v2 (
  id, target_type, target_id, parent_comment_id, author_id, body, body_format,
  annotation_json, resolved_at, created_at, updated_at, deleted_at
)
SELECT
  id, target_type, target_id, parent_comment_id, author_id, body, body_format,
  annotation_json, resolved_at, created_at, updated_at, deleted_at
FROM comments;

DROP TABLE comments;
ALTER TABLE comments_v2 RENAME TO comments;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS forum_boards (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES forum_boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_comment_id TEXT REFERENCES comments(id) ON DELETE SET NULL,
  last_comment_at TEXT NOT NULL,
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_boards_sort ON forum_boards(sort_order, title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_forum_threads_board_recent ON forum_threads(board_id, last_comment_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_author ON forum_threads(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_threads_recent ON forum_threads(last_comment_at DESC);
