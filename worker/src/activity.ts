import type { AuthenticatedUser, Env } from "./types";
import { signedMediaUrl } from "./media";
import { extractMentions, parseJson, stripMarkdownImages } from "./utils";

type ActivityUser = AuthenticatedUser & { handle?: string | null };

export type ActivityRow = {
  id: string;
  type: string;
  actor_id: string | null;
  subject_type: string;
  subject_id: string;
  target_type: string | null;
  target_id: string | null;
  payload_json: string | null;
  created_at: string;
};

export type ActivityJoinedRow = ActivityRow & {
  actor_handle: string | null;
  target_profile_handle: string | null;
  subject_gallery_title: string | null;
  subject_gallery_thumb_work_id: string | null;
  subject_gallery_thumb_version_id: string | null;
  subject_gallery_thumb_key: string | null;
  subject_gallery_thumb_type: string | null;
  subject_work_id: string | null;
  subject_work_title: string | null;
  subject_work_thumb_version_id: string | null;
  subject_work_thumb_key: string | null;
  subject_work_thumb_type: string | null;
  target_gallery_title: string | null;
  target_work_id: string | null;
  target_work_title: string | null;
  target_work_thumb_version_id: string | null;
  target_work_thumb_key: string | null;
  target_work_thumb_type: string | null;
  target_version_id: string | null;
  target_version_work_id: string | null;
  target_version_work_title: string | null;
  target_version_thumb_key: string | null;
  target_version_thumb_type: string | null;
  target_comment_body: string | null;
  target_comment_target_type: string | null;
  target_comment_target_id: string | null;
  comment_target_work_id: string | null;
  comment_target_work_title: string | null;
  comment_target_work_thumb_version_id: string | null;
  comment_target_work_thumb_key: string | null;
  comment_target_work_thumb_type: string | null;
  comment_target_gallery_title: string | null;
  comment_target_version_id: string | null;
  comment_target_version_work_id: string | null;
  comment_target_version_work_title: string | null;
  comment_target_version_thumb_key: string | null;
  comment_target_version_thumb_type: string | null;
  comment_target_profile_handle: string | null;
};

export type NotificationActivityJoinedRow = ActivityJoinedRow & {
  notification_id: string;
  notification_event_id: string;
  notification_type: string;
  notification_title?: string | null;
  notification_body: string;
  notification_action_url?: string | null;
  notification_read_at: string | null;
  notification_created_at: string;
};

export const ACTIVITY_CONTEXT_SELECT = `
     SELECT recent.*,
            actor.handle AS actor_handle,
            target_profile.handle AS target_profile_handle,
            subject_gallery.title AS subject_gallery_title,
            subject_gallery_cover.work_id AS subject_gallery_thumb_work_id,
            subject_gallery_cover.id AS subject_gallery_thumb_version_id,
            subject_gallery_cover.thumbnail_r2_key AS subject_gallery_thumb_key,
            subject_gallery_cover.thumbnail_content_type AS subject_gallery_thumb_type,
            subject_work.id AS subject_work_id,
            subject_work.title AS subject_work_title,
            subject_work_version.id AS subject_work_thumb_version_id,
            subject_work_version.thumbnail_r2_key AS subject_work_thumb_key,
            subject_work_version.thumbnail_content_type AS subject_work_thumb_type,
            target_gallery.title AS target_gallery_title,
            target_work.id AS target_work_id,
            target_work.title AS target_work_title,
            target_work_version.id AS target_work_thumb_version_id,
            target_work_version.thumbnail_r2_key AS target_work_thumb_key,
            target_work_version.thumbnail_content_type AS target_work_thumb_type,
            target_version.id AS target_version_id,
            target_version.work_id AS target_version_work_id,
            target_version_work.title AS target_version_work_title,
            target_version.thumbnail_r2_key AS target_version_thumb_key,
            target_version.thumbnail_content_type AS target_version_thumb_type,
            target_comment.body AS target_comment_body,
            target_comment.target_type AS target_comment_target_type,
            target_comment.target_id AS target_comment_target_id,
            comment_target_work.id AS comment_target_work_id,
            comment_target_work.title AS comment_target_work_title,
            comment_target_work_version.id AS comment_target_work_thumb_version_id,
            comment_target_work_version.thumbnail_r2_key AS comment_target_work_thumb_key,
            comment_target_work_version.thumbnail_content_type AS comment_target_work_thumb_type,
            comment_target_gallery.title AS comment_target_gallery_title,
            comment_target_version.id AS comment_target_version_id,
            comment_target_version.work_id AS comment_target_version_work_id,
            comment_target_version_work.title AS comment_target_version_work_title,
            comment_target_version.thumbnail_r2_key AS comment_target_version_thumb_key,
            comment_target_version.thumbnail_content_type AS comment_target_version_thumb_type,
            comment_target_profile.handle AS comment_target_profile_handle
     FROM recent
     LEFT JOIN users AS actor ON actor.id = recent.actor_id
     LEFT JOIN users AS target_profile ON recent.target_type = 'profile'
       AND target_profile.id = recent.target_id
       AND target_profile.disabled_at IS NULL
     LEFT JOIN galleries AS subject_gallery ON recent.subject_type = 'gallery'
       AND subject_gallery.id = recent.subject_id
     LEFT JOIN work_versions AS subject_gallery_cover ON subject_gallery_cover.id = subject_gallery.cover_version_id
     LEFT JOIN works AS subject_work ON recent.subject_type = 'work'
       AND subject_work.id = recent.subject_id
       AND subject_work.deleted_at IS NULL
     LEFT JOIN work_versions AS subject_work_version ON subject_work_version.id = subject_work.current_version_id
     LEFT JOIN galleries AS target_gallery ON recent.target_type = 'gallery'
       AND target_gallery.id = recent.target_id
     LEFT JOIN works AS target_work ON recent.target_type = 'work'
       AND target_work.id = recent.target_id
       AND target_work.deleted_at IS NULL
     LEFT JOIN work_versions AS target_work_version ON target_work_version.id = target_work.current_version_id
     LEFT JOIN work_versions AS target_version ON recent.target_type = 'version'
       AND target_version.id = recent.target_id
     LEFT JOIN works AS target_version_work ON target_version_work.id = target_version.work_id
       AND target_version_work.deleted_at IS NULL
     LEFT JOIN comments AS target_comment ON recent.target_type = 'comment'
       AND target_comment.id = recent.target_id
       AND target_comment.deleted_at IS NULL
     LEFT JOIN works AS comment_target_work ON target_comment.target_type = 'work'
       AND comment_target_work.id = target_comment.target_id
       AND comment_target_work.deleted_at IS NULL
     LEFT JOIN work_versions AS comment_target_work_version ON comment_target_work_version.id = comment_target_work.current_version_id
     LEFT JOIN galleries AS comment_target_gallery ON target_comment.target_type = 'gallery'
       AND comment_target_gallery.id = target_comment.target_id
     LEFT JOIN work_versions AS comment_target_version ON target_comment.target_type = 'version'
       AND comment_target_version.id = target_comment.target_id
     LEFT JOIN works AS comment_target_version_work ON comment_target_version_work.id = comment_target_version.work_id
       AND comment_target_version_work.deleted_at IS NULL
     LEFT JOIN users AS comment_target_profile ON target_comment.target_type = 'profile'
       AND comment_target_profile.id = target_comment.target_id
       AND comment_target_profile.disabled_at IS NULL`;

function addId(ids: Set<string>, value: string | null | undefined) {
  if (value) ids.add(value);
}

function placeholders(ids: string[]) {
  return ids.map(() => "?").join(",");
}

export async function visibleGalleryIds(db: D1Database, user: AuthenticatedUser, ids: Set<string>) {
  const values = [...ids];
  if (!values.length) return new Set<string>();
  const marker = placeholders(values);
  const rows = await db.prepare(
    `SELECT DISTINCT galleries.id
     FROM galleries
     LEFT JOIN gallery_members ON gallery_members.gallery_id = galleries.id
       AND gallery_members.user_id = ?
     WHERE galleries.id IN (${marker})
       AND (
         galleries.owner_user_id = ?
         OR galleries.created_by = ?
         OR galleries.visibility = 'server_public'
         OR galleries.whole_server_upload = 1
         OR galleries.ownership_type = 'whole_server'
         OR gallery_members.can_view = 1
       )`,
  ).bind(user.id, ...values, user.id, user.id).all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

export async function visibleWorkIds(db: D1Database, user: AuthenticatedUser, ids: Set<string>) {
  const values = [...ids];
  if (!values.length) return new Set<string>();
  const marker = placeholders(values);
  const rows = await db.prepare(
    `SELECT DISTINCT works.id
     FROM works
     LEFT JOIN work_galleries ON work_galleries.work_id = works.id
     LEFT JOIN galleries ON galleries.id = COALESCE(work_galleries.gallery_id, works.gallery_id)
     LEFT JOIN gallery_members ON gallery_members.gallery_id = galleries.id
       AND gallery_members.user_id = ?
     LEFT JOIN work_collaborators ON work_collaborators.work_id = works.id
       AND work_collaborators.user_id = ?
     WHERE works.deleted_at IS NULL
       AND works.id IN (${marker})
       AND (
         works.created_by = ?
         OR work_collaborators.user_id IS NOT NULL
         OR galleries.owner_user_id = ?
         OR galleries.created_by = ?
         OR galleries.visibility = 'server_public'
         OR galleries.whole_server_upload = 1
         OR galleries.ownership_type = 'whole_server'
         OR gallery_members.can_view = 1
       )`,
  ).bind(user.id, user.id, ...values, user.id, user.id, user.id).all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

export function collectActivityVisibilityIds(rows: ActivityJoinedRow[]) {
  const galleryIds = new Set<string>();
  const workIds = new Set<string>();
  for (const row of rows) {
    if (row.subject_type === "gallery") addId(galleryIds, row.subject_id);
    if (row.target_type === "gallery") addId(galleryIds, row.target_id);
    if (row.target_comment_target_type === "gallery") addId(galleryIds, row.target_comment_target_id);

    addId(workIds, row.subject_work_id);
    addId(workIds, row.target_work_id);
    addId(workIds, row.target_version_work_id);
    addId(workIds, row.comment_target_work_id);
    addId(workIds, row.comment_target_version_work_id);
  }
  return { galleryIds, workIds };
}

function targetVisible(row: ActivityJoinedRow, visibleGalleries: Set<string>, visibleWorks: Set<string>) {
  if (row.target_type === "gallery") return !!row.target_id && visibleGalleries.has(row.target_id);
  if (row.target_type === "work") return !!row.target_work_id && visibleWorks.has(row.target_work_id);
  if (row.target_type === "version") return !!row.target_version_work_id && visibleWorks.has(row.target_version_work_id);
  if (row.target_type === "profile") return !!row.target_profile_handle;
  if (row.target_type === "comment") {
    if (row.target_comment_target_type === "gallery") return !!row.target_comment_target_id && visibleGalleries.has(row.target_comment_target_id);
    if (row.target_comment_target_type === "work") return !!row.comment_target_work_id && visibleWorks.has(row.comment_target_work_id);
    if (row.target_comment_target_type === "version") return !!row.comment_target_version_work_id && visibleWorks.has(row.comment_target_version_work_id);
    if (row.target_comment_target_type === "profile") return !!row.comment_target_profile_handle;
  }
  return false;
}

function selfTargetedContributorEvent(user: AuthenticatedUser, row: ActivityJoinedRow) {
  if (row.type !== "work.collaborator_added" && row.type !== "work.collaborator_updated") return false;
  if (row.actor_id !== user.id) return false;
  const payload = parseJson<Record<string, unknown>>(row.payload_json || "", {});
  return payload.user_id === user.id;
}

export function joinedEventVisible(user: AuthenticatedUser, row: ActivityJoinedRow, visibleGalleries: Set<string>, visibleWorks: Set<string>) {
  if (row.type === "rules.published" || row.type === "rules.accepted") return false;
  if (selfTargetedContributorEvent(user, row)) return false;
  if (row.subject_type === "user") return row.type === "user.joined";
  if (row.subject_type === "profile") return true;
  if (row.subject_type === "gallery") return visibleGalleries.has(row.subject_id);
  if (row.subject_type === "work") return !!row.subject_work_id && visibleWorks.has(row.subject_work_id);
  if (row.target_type && row.target_id) return targetVisible(row, visibleGalleries, visibleWorks);
  return false;
}

function fallbackThumbnailUrl(workId: string | null, versionId: string | null) {
  return workId && versionId ? `/api/media/works/${workId}/versions/${versionId}/thumbnail` : null;
}

async function activityThumbnailUrl(
  env: Env,
  cache: Map<string, Promise<string | null>>,
  key: string | null,
  contentType: string | null,
  workId: string | null,
  versionId: string | null,
) {
  const fallback = fallbackThumbnailUrl(workId, versionId);
  if (!key) return fallback;
  const cacheKey = `${key}:${contentType || ""}:${fallback || ""}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, signedMediaUrl(env, key, contentType, "thumbnail").then((url) => url || fallback));
  }
  return cache.get(cacheKey)!;
}

export async function activityEntryFromJoinedRow(
  env: Env,
  user: ActivityUser,
  row: ActivityJoinedRow,
  thumbnailCache: Map<string, Promise<string | null>>,
) {
  const payload = parseJson<Record<string, unknown>>(row.payload_json, {});
  const actorLabel = row.actor_handle ? `@${row.actor_handle}` : "Someone";
  let summary = `${actorLabel} ${row.type.replace(/\./g, " ")}`;
  let href: string | null = null;
  let thumbnail_url: string | null = null;
  let comment_preview: string | null = null;

  if (row.type === "gallery.created" || row.type === "gallery.updated" || row.type === "gallery.visibility_changed") {
    const galleryTitle = row.subject_gallery_title || "gallery";
    href = `/galleries/${row.subject_id}`;
    const title = typeof payload.title === "string" && payload.title ? payload.title : galleryTitle;
    if (row.type === "gallery.created") summary = `${actorLabel} created gallery "${galleryTitle}"`;
    if (row.type === "gallery.updated") {
      summary = payload.previous_title && payload.previous_title !== title
        ? `${actorLabel} updated the gallery name to "${title}"`
        : `${actorLabel} updated gallery "${galleryTitle}"`;
    }
    if (row.type === "gallery.visibility_changed") summary = `${actorLabel} changed visibility on "${galleryTitle}"`;
    thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.subject_gallery_thumb_key, row.subject_gallery_thumb_type, row.subject_gallery_thumb_work_id, row.subject_gallery_thumb_version_id);
  } else if (row.type === "work.created" || row.type === "work.updated" || row.type === "work.crossposted" || row.type === "work.version_created" || row.type === "work.feedback_requested" || row.type === "work.collaborator_added" || row.type === "work.collaborator_updated") {
    const workTitle = row.subject_work_title || "work";
    href = row.subject_work_id ? `/works/${row.subject_work_id}` : null;
    if (row.target_version_id) {
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_version_thumb_key, row.target_version_thumb_type, row.target_version_work_id, row.target_version_id);
    } else {
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.subject_work_thumb_key, row.subject_work_thumb_type, row.subject_work_id, row.subject_work_thumb_version_id);
    }
    if (row.type === "work.created") summary = `${actorLabel} added "${workTitle}"`;
    if (row.type === "work.updated") summary = `${actorLabel} updated work "${workTitle}"`;
    if (row.type === "work.crossposted" || (row.type === "work.updated" && typeof payload.crossposted_to_gallery_id === "string")) {
      href = row.subject_work_id ? `/works/${row.subject_work_id}${row.target_id ? `?gallery=${row.target_id}` : ""}` : href;
      summary = `${actorLabel} crossposted "${workTitle}" to "${row.target_gallery_title || "another gallery"}"`;
    }
    if (row.type === "work.version_created") summary = `${actorLabel} updated work "${workTitle}"`;
    if (row.type === "work.feedback_requested") summary = `${actorLabel} requested feedback on "${workTitle}"`;
    if (row.type === "work.collaborator_added") summary = payload.user_id === user.id ? `${actorLabel} added you as a contributor on "${workTitle}"` : `${actorLabel} added a contributor on "${workTitle}"`;
    if (row.type === "work.collaborator_updated") summary = payload.user_id === user.id ? `${actorLabel} updated your contributor credit on "${workTitle}"` : `${actorLabel} updated a contributor credit on "${workTitle}"`;
  } else if (row.type === "comment.created" || row.type === "comment.replied") {
    const body = typeof payload.body === "string" ? payload.body : "";
    comment_preview = stripMarkdownImages(body).slice(0, 360);
    const mentionedYou = typeof user.handle === "string" && extractMentions(body).includes(user.handle.toLowerCase());
    if (row.target_type === "work" && row.target_work_id) {
      href = `/works/${row.target_work_id}#comment-${encodeURIComponent(row.subject_id)}`;
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_work_thumb_key, row.target_work_thumb_type, row.target_work_id, row.target_work_thumb_version_id);
      summary = mentionedYou ? `${actorLabel} mentioned you on "${row.target_work_title || "work"}"` : `${actorLabel} commented on "${row.target_work_title || "work"}"`;
    } else if (row.target_type === "gallery" && row.target_id) {
      href = `/galleries/${row.target_id}#comment-${encodeURIComponent(row.subject_id)}`;
      summary = mentionedYou ? `${actorLabel} mentioned you in gallery "${row.target_gallery_title || "gallery"}"` : `${actorLabel} commented in "${row.target_gallery_title || "gallery"}"`;
    } else if (row.target_type === "version" && row.target_version_work_id) {
      href = `/works/${row.target_version_work_id}#comment-${encodeURIComponent(row.subject_id)}`;
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_version_thumb_key, row.target_version_thumb_type, row.target_version_work_id, row.target_version_id);
      summary = mentionedYou ? `${actorLabel} mentioned you on a version of "${row.target_version_work_title || "work"}"` : `${actorLabel} commented on a version of "${row.target_version_work_title || "work"}"`;
    } else if (mentionedYou) {
      summary = `${actorLabel} mentioned you`;
    }
    if (row.type === "comment.replied" && !mentionedYou) summary = `${actorLabel} replied to a comment`;
  } else if (row.type === "reaction.created") {
    const targetType = String(payload.target_type || row.target_type || "");
    if (targetType === "work" && row.target_work_id) {
      href = `/works/${row.target_work_id}#heart-work-${encodeURIComponent(row.target_work_id)}`;
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_work_thumb_key, row.target_work_thumb_type, row.target_work_id, row.target_work_thumb_version_id);
      summary = `${actorLabel} liked "${row.target_work_title || "work"}"`;
    } else if (targetType === "gallery" && row.target_id) {
      href = `/galleries/${row.target_id}#heart-gallery-${encodeURIComponent(row.target_id)}`;
      summary = `${actorLabel} liked gallery "${row.target_gallery_title || "gallery"}"`;
    } else if (targetType === "comment") {
      const commentHash = row.target_id ? `#comment-${encodeURIComponent(row.target_id)}` : "";
      comment_preview = stripMarkdownImages(row.target_comment_body || "").slice(0, 240);
      summary = `${actorLabel} liked a comment`;
      if (row.target_comment_target_type === "work" && row.comment_target_work_id) {
        href = `/works/${row.comment_target_work_id}${commentHash}`;
        thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.comment_target_work_thumb_key, row.comment_target_work_thumb_type, row.comment_target_work_id, row.comment_target_work_thumb_version_id);
      }
      if (row.target_comment_target_type === "gallery" && row.target_comment_target_id) href = `/galleries/${row.target_comment_target_id}${commentHash}`;
      if (row.target_comment_target_type === "profile" && row.comment_target_profile_handle) href = `/members/${row.comment_target_profile_handle}${commentHash}`;
      if (row.target_comment_target_type === "version" && row.comment_target_version_work_id) {
        href = `/works/${row.comment_target_version_work_id}${commentHash}`;
        thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.comment_target_version_thumb_key, row.comment_target_version_thumb_type, row.comment_target_version_work_id, row.comment_target_version_id);
      }
    }
  } else if (row.type === "profile.updated") {
    summary = `${actorLabel} updated their profile`;
    href = row.actor_handle ? `/members/${row.actor_handle}` : null;
  } else if (row.type === "invite.accepted") {
    summary = `${actorLabel} accepted an invite`;
  } else if (row.type === "rules.published") {
    summary = `${actorLabel} published a new server rules version`;
  } else if (row.type === "rules.accepted") {
    summary = `${actorLabel} accepted the server rules`;
  } else if (row.type === "user.joined") {
    summary = `${actorLabel} joined`;
    href = row.actor_handle ? `/members/${row.actor_handle}` : null;
  }

  return {
    ...row,
    actor_handle: row.actor_handle || null,
    summary,
    href,
    thumbnail_url,
    comment_preview,
  };
}
