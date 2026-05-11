PRAGMA foreign_keys = ON;

ALTER TABLE export_jobs ADD COLUMN downloaded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_exports_expiry ON export_jobs(status, downloaded_at, expires_at);
