PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  disabled_at TEXT,
  display_name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  links_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links_json)),
  profile_image_key TEXT,
  profile_image_content_type TEXT,
  profile_image_alt_text TEXT NOT NULL DEFAULT '',
  avatar_key TEXT,
  avatar_content_type TEXT,
  avatar_alt_text TEXT NOT NULL DEFAULT '',
  avatar_crop_json TEXT CHECK (avatar_crop_json IS NULL OR json_valid(avatar_crop_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, url)
);

CREATE TABLE IF NOT EXISTS medium_tags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tag)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email TEXT,
  note TEXT NOT NULL DEFAULT '',
  role_on_join TEXT NOT NULL DEFAULT 'member' CHECK (role_on_join IN ('admin', 'member')),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (use_count <= max_uses)
);

CREATE TABLE IF NOT EXISTS invite_acceptances (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  accepted_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_email TEXT,
  role_granted TEXT NOT NULL CHECK (role_granted IN ('admin', 'member')),
  accepted_at TEXT NOT NULL,
  UNIQUE (invite_id, accepted_by)
);

CREATE TABLE IF NOT EXISTS role_suggestions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('gallery_member', 'work_collaborator')),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities_json)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scope, label)
);

CREATE TABLE IF NOT EXISTS galleries (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ownership_type TEXT NOT NULL DEFAULT 'self' CHECK (ownership_type IN ('self', 'collaborative')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'server_public')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_image_key TEXT,
  cover_image_content_type TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gallery_members (
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_suggestion_id TEXT REFERENCES role_suggestions(id) ON DELETE SET NULL,
  role_label TEXT NOT NULL DEFAULT 'member',
  can_view INTEGER NOT NULL DEFAULT 1 CHECK (can_view IN (0, 1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  can_upload_work INTEGER NOT NULL DEFAULT 0 CHECK (can_upload_work IN (0, 1)),
  can_comment INTEGER NOT NULL DEFAULT 1 CHECK (can_comment IN (0, 1)),
  can_manage_collaborators INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_collaborators IN (0, 1)),
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (gallery_id, user_id)
);

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'writing')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_warning TEXT,
  feedback_requested INTEGER NOT NULL DEFAULT 0 CHECK (feedback_requested IN (0, 1)),
  feedback_prompt TEXT,
  current_version_id TEXT REFERENCES work_versions(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS work_versions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  change_note TEXT NOT NULL DEFAULT '',
  body_markdown TEXT,
  body_plain TEXT,
  original_r2_key TEXT,
  original_content_type TEXT,
  original_filename TEXT,
  original_size_bytes INTEGER CHECK (original_size_bytes IS NULL OR original_size_bytes >= 0),
  original_width INTEGER CHECK (original_width IS NULL OR original_width > 0),
  original_height INTEGER CHECK (original_height IS NULL OR original_height > 0),
  preview_r2_key TEXT,
  preview_content_type TEXT,
  preview_width INTEGER CHECK (preview_width IS NULL OR preview_width > 0),
  preview_height INTEGER CHECK (preview_height IS NULL OR preview_height > 0),
  thumbnail_r2_key TEXT,
  thumbnail_content_type TEXT,
  thumbnail_width INTEGER CHECK (thumbnail_width IS NULL OR thumbnail_width > 0),
  thumbnail_height INTEGER CHECK (thumbnail_height IS NULL OR thumbnail_height > 0),
  alt_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (work_id, version_number)
);

CREATE TABLE IF NOT EXISTS work_collaborators (
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
  CHECK (display_name <> '' OR user_id IS NOT NULL),
  UNIQUE (work_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'gallery', 'work', 'version', 'comment')),
  target_id TEXT NOT NULL,
  parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  body_format TEXT NOT NULL DEFAULT 'markdown' CHECK (body_format IN ('markdown', 'plain')),
  annotation_json TEXT CHECK (annotation_json IS NULL OR json_valid(annotation_json)),
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  action_url TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  read_at TEXT,
  emailed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'user' CHECK (target_type IN ('user', 'gallery', 'work')),
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'cancelled')),
  options_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)),
  manifest_r2_key TEXT,
  archive_r2_key TEXT,
  archive_content_type TEXT,
  archive_size_bytes INTEGER CHECK (archive_size_bytes IS NULL OR archive_size_bytes >= 0),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS instance_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  description TEXT NOT NULL DEFAULT '',
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO admin_bootstrap (id, created_at, updated_at)
VALUES (1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO instance_settings (key, value_json, description, created_at, updated_at)
VALUES
  ('instance_name', '{"value":"QuietCollective"}', 'Display name for this community instance.', datetime('now'), datetime('now')),
  ('registration_mode', '{"value":"invite_only"}', 'Registration policy after bootstrap setup.', datetime('now'), datetime('now')),
  ('default_gallery_visibility', '{"value":"private"}', 'Default visibility for newly created galleries.', datetime('now'), datetime('now')),
  ('server_public_requires_login', '{"value":true}', 'Server-public galleries are visible to signed-in members only.', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO role_suggestions (id, scope, label, description, capabilities_json, sort_order, created_at, updated_at)
VALUES
  ('gallery_viewer', 'gallery_member', 'Viewer', 'Can view the gallery.', '{"view":true,"edit":false,"upload_work":false,"comment":false,"manage_collaborators":false}', 10, datetime('now'), datetime('now')),
  ('gallery_critic', 'gallery_member', 'Critic', 'Can view and comment on gallery work.', '{"view":true,"edit":false,"upload_work":false,"comment":true,"manage_collaborators":false}', 20, datetime('now'), datetime('now')),
  ('gallery_contributor', 'gallery_member', 'Contributor', 'Can upload work and participate in critique.', '{"view":true,"edit":false,"upload_work":true,"comment":true,"manage_collaborators":false}', 30, datetime('now'), datetime('now')),
  ('gallery_manager', 'gallery_member', 'Manager', 'Can edit gallery details and manage collaborators.', '{"view":true,"edit":true,"upload_work":true,"comment":true,"manage_collaborators":true}', 40, datetime('now'), datetime('now')),
  ('work_muse', 'work_collaborator', 'muse', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 1, datetime('now'), datetime('now')),
  ('work_artist_common', 'work_collaborator', 'artist', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 2, datetime('now'), datetime('now')),
  ('work_photographer', 'work_collaborator', 'photographer', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 3, datetime('now'), datetime('now')),
  ('work_model', 'work_collaborator', 'model', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 4, datetime('now'), datetime('now')),
  ('work_mua', 'work_collaborator', 'mua', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 5, datetime('now'), datetime('now')),
  ('work_lighting', 'work_collaborator', 'lighting', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 6, datetime('now'), datetime('now')),
  ('work_writer_common', 'work_collaborator', 'writer', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 7, datetime('now'), datetime('now')),
  ('work_editor_common', 'work_collaborator', 'editor', 'Common collaborator credit.', '{"edit":true,"version":true,"comment":true}', 8, datetime('now'), datetime('now')),
  ('work_stylist', 'work_collaborator', 'stylist', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 9, datetime('now'), datetime('now')),
  ('work_reference', 'work_collaborator', 'reference', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 10, datetime('now'), datetime('now')),
  ('work_assistant', 'work_collaborator', 'assistant', 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 11, datetime('now'), datetime('now')),
  ('work_artist', 'work_collaborator', 'Artist', 'Primary visual or mixed-media contributor.', '{"edit":false,"version":false,"comment":true}', 10, datetime('now'), datetime('now')),
  ('work_writer', 'work_collaborator', 'Writer', 'Primary writing contributor.', '{"edit":false,"version":false,"comment":true}', 20, datetime('now'), datetime('now')),
  ('work_editor', 'work_collaborator', 'Editor', 'Can help revise work versions.', '{"edit":true,"version":true,"comment":true}', 30, datetime('now'), datetime('now')),
  ('work_contributor', 'work_collaborator', 'Contributor', 'Custom credited contributor.', '{"edit":false,"version":false,"comment":true}', 40, datetime('now'), datetime('now'));

CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_users_role_disabled ON users(role, disabled_at);
CREATE INDEX IF NOT EXISTS idx_profile_links_user_sort ON profile_links(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_medium_tags_tag_user ON medium_tags(tag, user_id);
CREATE INDEX IF NOT EXISTS idx_invites_hash ON invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_invites_active ON invites(revoked_at, expires_at, use_count, max_uses);
CREATE INDEX IF NOT EXISTS idx_invite_acceptances_invite ON invite_acceptances(invite_id, accepted_at);
CREATE INDEX IF NOT EXISTS idx_invite_acceptances_user ON invite_acceptances(accepted_by, accepted_at);
CREATE INDEX IF NOT EXISTS idx_role_suggestions_scope ON role_suggestions(scope, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_galleries_owner ON galleries(owner_user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_galleries_created_by ON galleries(created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_galleries_visibility ON galleries(visibility, updated_at);
CREATE INDEX IF NOT EXISTS idx_gallery_members_user ON gallery_members(user_id);
CREATE INDEX IF NOT EXISTS idx_gallery_members_role ON gallery_members(role_suggestion_id);
CREATE INDEX IF NOT EXISTS idx_works_gallery ON works(gallery_id, deleted_at, sort_order);
CREATE INDEX IF NOT EXISTS idx_works_created_by ON works(created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_works_current_version ON works(current_version_id);
CREATE INDEX IF NOT EXISTS idx_works_feedback ON works(feedback_requested, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_versions_work ON work_versions(work_id, version_number);
CREATE INDEX IF NOT EXISTS idx_work_versions_created_by ON work_versions(created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_work_collaborators_work ON work_collaborators(work_id, credit_order);
CREATE INDEX IF NOT EXISTS idx_work_collaborators_user ON work_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_work_collaborators_role ON work_collaborators(role_suggestion_id);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON domain_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON domain_events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_subject ON domain_events(subject_type, subject_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_target ON domain_events(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON domain_events(processed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_event ON notifications(event_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type, created_at);
CREATE INDEX IF NOT EXISTS idx_exports_user ON export_jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exports_status ON export_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_exports_target ON export_jobs(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_instance_settings_updated_by ON instance_settings(updated_by, updated_at);
