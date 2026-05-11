PRAGMA foreign_keys = ON;

ALTER TABLE works ADD COLUMN feedback_requested_at TEXT;

UPDATE works
SET feedback_requested_at = updated_at
WHERE feedback_requested = 1
  AND feedback_requested_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_works_feedback_requested_at
  ON works(feedback_requested, feedback_requested_at);
