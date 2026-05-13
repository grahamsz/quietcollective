import type { AppUser, GalleryRow, WorkRow } from "./types";
import { extractTags, jsonText, normalizeTag, now, parseJson } from "./utils";

export const TAG_INDEX_READY_KEY = "tag_index_rebuilt_at";

type TagIndexTargetType = "gallery" | "work" | "comment" | "user";

type TagIndexSource = {
  source: string;
  text?: string;
  tags?: string[];
  updatedAt?: string;
};

type CommentTagRow = {
  id: string;
  body: string;
  updated_at: string;
  deleted_at: string | null;
};

function uniqueNormalizedTags(source: TagIndexSource) {
  const tags = source.tags
    ? source.tags.map((tag) => normalizeTag(tag))
    : extractTags(source.text || "");
  return [...new Set(tags.filter(Boolean))].slice(0, 120);
}

function tagIndexEntries(targetType: TagIndexTargetType, targetId: string, sources: TagIndexSource[], fallbackUpdatedAt: string) {
  const entries = new Map<string, { tag: string; targetType: TagIndexTargetType; targetId: string; source: string; updatedAt: string }>();
  for (const source of sources) {
    const sourceName = source.source.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "text";
    const updatedAt = source.updatedAt || fallbackUpdatedAt;
    for (const tag of uniqueNormalizedTags(source)) {
      entries.set(`${tag}\0${sourceName}`, { tag, targetType, targetId, source: sourceName, updatedAt });
    }
  }
  return [...entries.values()];
}

export async function removeTagIndexForTarget(db: D1Database, targetType: TagIndexTargetType, targetId: string) {
  await db.prepare("DELETE FROM tag_index WHERE target_type = ? AND target_id = ?").bind(targetType, targetId).run();
}

export async function replaceTagIndexForTarget(db: D1Database, targetType: TagIndexTargetType, targetId: string, sources: TagIndexSource[], fallbackUpdatedAt = now()) {
  const entries = tagIndexEntries(targetType, targetId, sources, fallbackUpdatedAt);
  const statements = [
    db.prepare("DELETE FROM tag_index WHERE target_type = ? AND target_id = ?").bind(targetType, targetId),
    ...entries.map((entry) => db.prepare(
      `INSERT INTO tag_index (tag, target_type, target_id, source, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(entry.tag, entry.targetType, entry.targetId, entry.source, entry.updatedAt)),
  ];
  await db.batch(statements);
}

export async function reindexGalleryTags(db: D1Database, galleryId: string, gallery?: GalleryRow | null) {
  const row = gallery ?? await db.prepare("SELECT * FROM galleries WHERE id = ?").bind(galleryId).first<GalleryRow>();
  if (!row) {
    await removeTagIndexForTarget(db, "gallery", galleryId);
    return;
  }
  await replaceTagIndexForTarget(db, "gallery", row.id, [
    { source: "text", text: `${row.title || ""} ${row.description || ""}`, updatedAt: row.updated_at || row.created_at },
  ], row.updated_at || row.created_at);
}

export async function reindexWorkTags(db: D1Database, workId: string, work?: WorkRow | null) {
  const row = work ?? await db.prepare("SELECT * FROM works WHERE id = ?").bind(workId).first<WorkRow>();
  if (!row || row.deleted_at) {
    await removeTagIndexForTarget(db, "work", workId);
    return;
  }
  await replaceTagIndexForTarget(db, "work", row.id, [
    { source: "text", text: `${row.title || ""} ${row.description || ""}`, updatedAt: row.updated_at || row.created_at },
  ], row.updated_at || row.created_at);
}

export async function reindexCommentTags(db: D1Database, commentId: string, comment?: CommentTagRow | null) {
  const row = comment ?? await db.prepare("SELECT id, body, updated_at, deleted_at FROM comments WHERE id = ?").bind(commentId).first<CommentTagRow>();
  if (!row || row.deleted_at) {
    await removeTagIndexForTarget(db, "comment", commentId);
    return;
  }
  await replaceTagIndexForTarget(db, "comment", row.id, [
    { source: "body", text: row.body || "", updatedAt: row.updated_at },
  ], row.updated_at);
}

export async function reindexUserTags(db: D1Database, userId: string, user?: AppUser | null) {
  const row = user ?? await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<AppUser>();
  if (!row || row.disabled_at) {
    await removeTagIndexForTarget(db, "user", userId);
    return;
  }
  const mediumRows = await db.prepare("SELECT tag, created_at FROM medium_tags WHERE user_id = ? ORDER BY tag")
    .bind(userId)
    .all<{ tag: string; created_at: string }>();
  const mediumUpdatedAt = mediumRows.results.reduce((latest, item) => item.created_at > latest ? item.created_at : latest, row.updated_at || row.created_at);
  await replaceTagIndexForTarget(db, "user", row.id, [
    { source: "bio", text: row.bio || "", updatedAt: row.updated_at || row.created_at },
    { source: "medium_tags", tags: mediumRows.results.map((item) => item.tag), updatedAt: mediumUpdatedAt },
  ], row.updated_at || row.created_at);
}

export async function tagIndexReady(db: D1Database) {
  const row = await db.prepare("SELECT value_json FROM instance_settings WHERE key = ?").bind(TAG_INDEX_READY_KEY).first<{ value_json: string }>();
  return !!parseJson<{ value?: string }>(row?.value_json, {}).value;
}

async function markTagIndexReady(db: D1Database) {
  const timestamp = now();
  await db.prepare(
    `INSERT INTO instance_settings (key, value_json, description, created_at, updated_at)
     VALUES (?, ?, 'Timestamp of the last complete tag index rebuild.', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).bind(TAG_INDEX_READY_KEY, jsonText({ value: timestamp }), timestamp, timestamp).run();
}

async function markTagIndexNotReady(db: D1Database) {
  await db.prepare("DELETE FROM instance_settings WHERE key = ?").bind(TAG_INDEX_READY_KEY).run();
}

export async function rebuildTagIndex(db: D1Database) {
  await markTagIndexNotReady(db);
  await db.prepare("DELETE FROM tag_index").run();

  const [galleries, works, comments, users] = await Promise.all([
    db.prepare("SELECT * FROM galleries").all<GalleryRow>(),
    db.prepare("SELECT * FROM works WHERE deleted_at IS NULL").all<WorkRow>(),
    db.prepare("SELECT id, body, updated_at, deleted_at FROM comments WHERE deleted_at IS NULL").all<CommentTagRow>(),
    db.prepare("SELECT * FROM users WHERE disabled_at IS NULL").all<AppUser>(),
  ]);

  for (const gallery of galleries.results) await reindexGalleryTags(db, gallery.id, gallery);
  for (const work of works.results) await reindexWorkTags(db, work.id, work);
  for (const comment of comments.results) await reindexCommentTags(db, comment.id, comment);
  for (const user of users.results) await reindexUserTags(db, user.id, user);

  await markTagIndexReady(db);
}
