PRAGMA foreign_keys = ON;

ALTER TABLE galleries ADD COLUMN whole_server_upload INTEGER NOT NULL DEFAULT 0 CHECK (whole_server_upload IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_galleries_whole_server_upload ON galleries(whole_server_upload, updated_at);
