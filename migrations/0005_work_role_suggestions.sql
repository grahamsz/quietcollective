INSERT OR IGNORE INTO role_suggestions (id, scope, label, description, capabilities_json, sort_order, created_at, updated_at)
VALUES
  ('work_staging', 'work_collaborator', 'staging', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":false}', 12, datetime('now'), datetime('now')),
  ('work_make_up', 'work_collaborator', 'make-up', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":false}', 13, datetime('now'), datetime('now'));
