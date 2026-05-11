PRAGMA foreign_keys = ON;

ALTER TABLE markdown_assets ADD COLUMN preview_r2_key TEXT;
ALTER TABLE markdown_assets ADD COLUMN preview_content_type TEXT;
ALTER TABLE markdown_assets ADD COLUMN thumbnail_r2_key TEXT;
ALTER TABLE markdown_assets ADD COLUMN thumbnail_content_type TEXT;
