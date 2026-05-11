PRAGMA foreign_keys = ON;

UPDATE galleries
SET visibility = 'private'
WHERE ownership_type = 'self'
  AND whole_server_upload = 0
  AND visibility = 'server_public';
