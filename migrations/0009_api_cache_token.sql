PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO instance_settings (key, value_json, description, created_at, updated_at)
VALUES (
  'api_cache_token',
  json_object('value', lower(hex(randomblob(16)))),
  'Coarse invalidation token for cacheable API reads.',
  datetime('now'),
  datetime('now')
);
