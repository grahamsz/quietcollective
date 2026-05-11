ALTER TABLE works ADD COLUMN client_upload_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_works_created_by_client_upload_key
  ON works(created_by, client_upload_key)
  WHERE client_upload_key IS NOT NULL;
