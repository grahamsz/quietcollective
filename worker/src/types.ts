export type Role = "admin" | "member";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  JOBS?: Queue;
  JWT_SECRET?: string;
  ADMIN_SETUP_TOKEN?: string;
  INSTANCE_NAME?: string;
  SOURCE_CODE_URL?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
}

export interface AppUser {
  id: string;
  email: string;
  role: Role;
  disabled_at: string | null;
  display_name: string;
  handle: string;
  bio: string;
  links_json: string;
  profile_image_key: string | null;
  profile_image_content_type: string | null;
  avatar_key: string | null;
  avatar_content_type: string | null;
  avatar_crop_json: string | null;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GalleryCapabilities {
  view: boolean;
  edit: boolean;
  upload_work: boolean;
  comment: boolean;
  manage_collaborators: boolean;
}

export interface GalleryRow {
  id: string;
  owner_user_id: string;
  ownership_type: "self" | "collaborative" | "whole_server";
  visibility: "private" | "server_public";
  title: string;
  description: string;
  created_by: string;
  cover_image_key: string | null;
  cover_image_content_type: string | null;
  cover_work_id: string | null;
  cover_version_id: string | null;
  whole_server_upload: number;
  created_at: string;
  updated_at: string;
}

export interface WorkRow {
  id: string;
  gallery_id: string;
  type: "image" | "writing";
  title: string;
  description: string;
  content_warning: string | null;
  feedback_requested: number;
  feedback_prompt: string | null;
  current_version_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface WorkVersionRow {
  id: string;
  work_id: string;
  version_number: number;
  body_markdown: string | null;
  body_plain: string | null;
  original_r2_key: string | null;
  original_content_type: string | null;
  preview_r2_key: string | null;
  preview_content_type: string | null;
  thumbnail_r2_key: string | null;
  thumbnail_content_type: string | null;
  original_filename: string | null;
  created_by: string;
  created_at: string;
}
