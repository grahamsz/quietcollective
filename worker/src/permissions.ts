import type { AppUser, GalleryCapabilities, GalleryRow, WorkRow } from "./types";

type WorkPermissionUser = Pick<AppUser, "id" | "role">;
type GalleryPermissionGallery = Pick<GalleryRow, "owner_user_id" | "created_by" | "ownership_type" | "whole_server_upload">;
type WorkPermissionWork = Pick<WorkRow, "created_by">;

export type GalleryMemberPermissions = {
  can_view: number | boolean;
  can_edit: number | boolean;
  can_upload_work: number | boolean;
  can_comment: number | boolean;
  can_manage_collaborators: number | boolean;
} | null;

export type WorkCollaboratorPermissions = {
  can_edit: number | boolean;
  can_version: number | boolean;
  can_comment: number | boolean;
} | null;

export type ResolvedWorkCapabilities = {
  caps: GalleryCapabilities;
  version: boolean;
  crosspost: boolean;
};

export function ownsGallery(user: WorkPermissionUser, gallery: GalleryPermissionGallery) {
  return gallery.owner_user_id === user.id || gallery.created_by === user.id;
}

export function canCrosspostToGallery({
  caps,
  gallery,
  user,
}: {
  caps: Pick<GalleryCapabilities, "upload_work">;
  gallery: GalleryPermissionGallery;
  user: WorkPermissionUser;
}) {
  if (!caps.upload_work) return false;
  if (ownsGallery(user, gallery)) return true;
  return gallery.ownership_type === "whole_server" || !!gallery.whole_server_upload;
}

export function resolveGalleryCapabilities({
  baseCaps,
  gallery,
  member,
}: {
  baseCaps: GalleryCapabilities;
  gallery: Pick<GalleryRow, "ownership_type" | "whole_server_upload">;
  member?: GalleryMemberPermissions;
}) {
  if (!member) return baseCaps;
  const individualGallery = gallery.ownership_type === "self" && !gallery.whole_server_upload;
  return {
    view: baseCaps.view || !!member.can_view,
    edit: baseCaps.edit || (!individualGallery && !!member.can_edit),
    upload_work: baseCaps.upload_work || (!individualGallery && !!member.can_upload_work),
    comment: baseCaps.comment || !!member.can_comment,
    manage_collaborators: baseCaps.manage_collaborators || (!individualGallery && !!member.can_manage_collaborators),
  };
}

export function resolveWorkCapabilities({
  galleryCaps,
  work,
  user,
  collaborator,
}: {
  galleryCaps: GalleryCapabilities;
  work: WorkPermissionWork;
  user: WorkPermissionUser;
  collaborator?: WorkCollaboratorPermissions;
}): ResolvedWorkCapabilities {
  const ownsWork = work.created_by === user.id;
  const admin = user.role === "admin";
  const collaboratorCanEdit = !!collaborator?.can_edit;
  const collaboratorCanVersion = !!collaborator?.can_version;
  const collaboratorCanComment = !!collaborator?.can_comment;
  const canEdit = ownsWork || collaboratorCanEdit;
  const canCrosspost = ownsWork || !!collaborator;

  return {
    caps: {
      view: galleryCaps.view || ownsWork || admin || !!collaborator,
      edit: canEdit,
      upload_work: galleryCaps.upload_work || ownsWork || collaboratorCanVersion,
      comment: galleryCaps.comment || ownsWork || collaboratorCanComment,
      manage_collaborators: canEdit,
    },
    version: canEdit || collaboratorCanVersion,
    crosspost: canCrosspost,
  };
}
