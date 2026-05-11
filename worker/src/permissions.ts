import type { AppUser, GalleryCapabilities, WorkRow } from "./types";

type WorkPermissionUser = Pick<AppUser, "id" | "role">;
type WorkPermissionWork = Pick<WorkRow, "created_by">;

export type WorkCollaboratorPermissions = {
  can_edit: number | boolean;
  can_version: number | boolean;
  can_comment: number | boolean;
} | null;

export type ResolvedWorkCapabilities = {
  caps: GalleryCapabilities;
  version: boolean;
};

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
  const canEdit = ownsWork || admin || collaboratorCanEdit;

  return {
    caps: {
      view: galleryCaps.view || ownsWork || admin || !!collaborator,
      edit: canEdit,
      upload_work: galleryCaps.upload_work || ownsWork || admin || collaboratorCanVersion,
      comment: galleryCaps.comment || ownsWork || admin || collaboratorCanComment,
      manage_collaborators: canEdit,
    },
    version: canEdit || collaboratorCanVersion,
  };
}
