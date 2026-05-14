export type AccessUser = {
  handle?: string | null;
  display_name?: string | null;
};

export type GalleryOwnershipSummary = {
  owner_handle?: string | null;
  owner_display_name?: string | null;
  viewer_count?: number | null;
  additional_viewer_count?: number | null;
  submitters?: AccessUser[];
  submitter_count?: number | null;
  additional_submitter_count?: number | null;
  viewers?: AccessUser[];
  additional_visible_viewer_count?: number | null;
};

export type Gallery = {
  id: string;
  title: string;
  description?: string;
  owner_user_id?: string;
  ownership_type?: "self" | "collaborative" | "whole_server" | string;
  visibility?: "private" | "server_public" | string;
  whole_server_upload?: boolean | number;
  cover_image_url?: string | null;
  work_count?: number | null;
  works_count?: number | null;
  capabilities?: {
    view?: boolean | number | null;
    edit?: boolean | number | null;
    upload_work?: boolean | number | null;
    comment?: boolean | number | null;
    manage_collaborators?: boolean | number | null;
  } | null;
  ownership_summary?: GalleryOwnershipSummary | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkVersion = {
  id?: string;
  preview_url?: string | null;
  thumbnail_url?: string | null;
};

export type ReactionSummary = {
  heart_count?: number | null;
  hearted_by_me?: boolean | null;
};

export type Work = {
  id: string;
  title: string;
  description?: string | null;
  current_version?: WorkVersion | null;
  reactions?: ReactionSummary | null;
  feedback_requested?: boolean | number | null;
  feedback_dismissed?: boolean | number | null;
  feedback_prompt?: string | null;
  is_owner?: boolean | number | null;
  created_by_user?: AccessUser | null;
  created_by_handle?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};
