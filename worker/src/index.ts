import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import * as bcrypt from "bcryptjs";
import { ulid } from "ulid";
import type { AppUser, Env, GalleryCapabilities, GalleryRow, WorkRow, WorkVersionRow } from "./types";

type Variables = {
  user: AppUser;
};

type AppContext = {
  Bindings: Env;
  Variables: Variables;
};

const app = new Hono<AppContext>();

type Ctx = Context<AppContext>;

type WorkCollaboratorInput = Record<string, unknown>;

type WorkCollaboratorResult = {
  ok: boolean;
  id?: string;
  display_name?: string;
  user_id?: string | null;
  role_label?: string;
  duplicate?: boolean;
  error?: string;
};

const ROLE_SUGGESTIONS = [
  "muse",
  "artist",
  "photographer",
  "model",
  "lighting",
  "staging",
  "make-up",
  "writer",
  "editor",
  "stylist",
  "reference",
  "assistant",
];

const EMPTY_CAPABILITIES: GalleryCapabilities = {
  view: false,
  edit: false,
  upload_work: false,
  comment: false,
  manage_collaborators: false,
};

const OWNER_CAPABILITIES: GalleryCapabilities = {
  view: true,
  edit: true,
  upload_work: true,
  comment: true,
  manage_collaborators: true,
};

function now() {
  return new Date().toISOString();
}

function jsonText(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function extractMentions(value: string) {
  return Array.from(new Set(Array.from(value.matchAll(/(^|\s)@([a-z0-9_-]+)/gi)).map((match) => match[2].toLowerCase())));
}

function stripMarkdownImages(value: string) {
  return value.replace(/!\[[^\]]*]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeTag(value: string) {
  return value.trim().replace(/^#/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function normalizeRoleLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeClientUploadKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 120);
}

function normalizeGalleryOwnership(value: unknown): "self" | "collaborative" | "whole_server" {
  const normalized = stringField(value || "self").toLowerCase().replace(/-/g, "_");
  if (normalized === "whole_server" || normalized === "server_public" || normalized === "community") return "whole_server";
  if (normalized === "collaborative") return "collaborative";
  return "self";
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cacheControl(variant: string) {
  return variant === "original"
    ? "private, no-store"
    : "private, max-age=3600";
}

function getSecret(env: Env) {
  return env.JWT_SECRET || env.ADMIN_SETUP_TOKEN || "";
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToString(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function sha256(value: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

type SignedMediaPayload = {
  key: string;
  content_type?: string | null;
  variant: string;
  filename?: string | null;
  exp: number;
};

async function signedMediaUrl(env: Env, key: string | null | undefined, contentType: string | null | undefined, variant: string, filename?: string | null) {
  if (!key) return null;
  const secret = getSecret(env);
  if (!secret) return null;
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const ttlHours = variant === "original" ? 2 : 8;
  const payload: SignedMediaPayload = {
    key,
    content_type: contentType || null,
    variant,
    filename: filename || null,
    exp: (hourBucket + ttlHours) * 60 * 60,
  };
  const data = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `/api/media/signed/${data}.${await sign(data, secret)}`;
}

async function readSignedMediaPayload(env: Env, token: string): Promise<SignedMediaPayload | null> {
  const secret = getSecret(env);
  if (!secret) return null;
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  if (await sign(data, secret) !== signature) return null;
  const payload = parseJson<SignedMediaPayload>(base64UrlToString(data), { key: "", variant: "", exp: 0 });
  if (!payload.key || !payload.variant || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function createSession(userId: string, env: Env) {
  const secret = getSecret(env);
  if (!secret) throw new Error("Server authentication is not configured");
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${userId}.${expiresAt}.${nonce}`;
  return `${payload}.${await sign(payload, secret)}`;
}

async function readSessionUserId(token: string, env: Env) {
  const secret = getSecret(env);
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = await sign(payload, secret);
  if (expected !== parts[3]) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;
  return parts[0];
}

function parseCookies(header: string | null | undefined) {
  const cookies = new Map<string, string>();
  for (const part of (header || "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

function sessionCookie(token: string) {
  return `qc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`;
}

function expiredSessionCookie() {
  return "qc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

async function readBody(c: Ctx) {
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    return c.req.parseBody();
  }
  if (contentType.includes("application/json")) {
    return c.req.json().catch(() => ({}));
  }
  return {};
}

function stringField(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

function numberField(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fileField(value: unknown): File | null {
  return value instanceof File ? value : null;
}

async function getUserById(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<AppUser>();
}

async function getUserByHandle(db: D1Database, handle: string) {
  return db.prepare("SELECT * FROM users WHERE handle = ? AND disabled_at IS NULL").bind(normalizeHandle(handle)).first<AppUser>();
}

async function ensureWorkRoleSuggestion(db: D1Database, label: string, userId: string | null) {
  const normalized = normalizeRoleLabel(label);
  if (!normalized) return null;
  const existing = await db.prepare("SELECT id FROM role_suggestions WHERE scope = 'work_collaborator' AND label = ?").bind(normalized).first<{ id: string }>();
  if (existing) return existing.id;
  const id = `work_${ulid()}`;
  const timestamp = now();
  await db.prepare(
    `INSERT INTO role_suggestions
       (id, scope, label, description, capabilities_json, sort_order, created_by, created_at, updated_at)
     VALUES (?, 'work_collaborator', ?, 'Community collaborator credit.', '{"edit":false,"version":false,"comment":false}', 100, ?, ?, ?)`,
  ).bind(id, normalized, userId, timestamp, timestamp).run();
  return id;
}

async function requireUser(c: Ctx, next: Next) {
  const auth = c.req.header("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || parseCookies(c.req.header("cookie")).get("qc_session");
  if (!token) return c.json({ error: "Not authenticated" }, 401);

  const userId = await readSessionUserId(token, c.env);
  if (!userId) return c.json({ error: "Not authenticated" }, 401);

  const user = await getUserById(c.env.DB, userId);
  if (!user || user.disabled_at) return c.json({ error: "Not authenticated" }, 401);

  c.set("user", user);
  const lastActive = user.last_active_at ? Date.parse(user.last_active_at) : 0;
  if (!lastActive || Date.now() - lastActive > 60 * 60 * 1000) {
    const timestamp = now();
    await c.env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(timestamp, user.id).run().catch(() => undefined);
    user.last_active_at = timestamp;
  }
  await next();
}

function currentUser(c: Ctx) {
  return c.get("user");
}

function publicUser(user: AppUser, tags: string[] = []) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    disabled_at: user.disabled_at,
    display_name: user.handle,
    handle: user.handle,
    bio: user.bio,
    links: parseJson(user.links_json, []),
    medium_tags: tags,
    profile_image_url: user.profile_image_key ? `/api/media/users/${user.id}/profile` : null,
    avatar_url: user.avatar_key ? `/api/media/users/${user.id}/avatar` : null,
    avatar_crop: parseJson(user.avatar_crop_json, null),
    last_active_at: user.last_active_at || null,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function getTags(db: D1Database, userId: string) {
  const rows = await db.prepare("SELECT tag FROM medium_tags WHERE user_id = ? ORDER BY tag").bind(userId).all<{ tag: string }>();
  return rows.results.map((row) => row.tag);
}

async function getSetting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db.prepare("SELECT value_json FROM instance_settings WHERE key = ?").bind(key).first<{ value_json: string }>();
  if (!row) return fallback;
  const parsed = parseJson<{ value?: T }>(row.value_json, {});
  return parsed.value ?? fallback;
}

async function setSetting(db: D1Database, key: string, value: unknown, actorId: string | null, description = "") {
  const timestamp = now();
  await db.prepare(
    `INSERT INTO instance_settings (key, value_json, description, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       description = COALESCE(NULLIF(excluded.description, ''), instance_settings.description),
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(key, jsonText({ value }), description, actorId, timestamp, timestamp).run();
}

async function instanceInfo(env: Env) {
  const name = await getSetting(env.DB, "instance_name", env.INSTANCE_NAME || "QuietCollective");
  const sourceCodeUrl = await getSetting(env.DB, "source_code_url", env.SOURCE_CODE_URL || "");
  const logoKey = await getSetting<string | null>(env.DB, "logo_r2_key", null);
  return {
    name,
    source_code_url: sourceCodeUrl,
    logo_url: logoKey ? "/api/instance/logo" : "",
    content_notice: "Uploaded user content remains owned by the uploader or rights holder.",
  };
}

async function adminCount(db: D1Database) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL").first<{ count: number }>();
  return row?.count || 0;
}

async function isAdmin(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT role FROM users WHERE id = ? AND disabled_at IS NULL").bind(userId).first<{ role: string }>();
  return row?.role === "admin";
}

async function galleryCapabilities(db: D1Database, user: AppUser, galleryId: string): Promise<GalleryCapabilities> {
  if (user.role === "admin") return OWNER_CAPABILITIES;
  const gallery = await db.prepare("SELECT * FROM galleries WHERE id = ?").bind(galleryId).first<GalleryRow>();
  if (!gallery) return EMPTY_CAPABILITIES;
  if (gallery.owner_user_id === user.id || gallery.created_by === user.id) return OWNER_CAPABILITIES;
  const wholeServerUpload = !!gallery.whole_server_upload || gallery.ownership_type === "whole_server";
  const baseCaps = wholeServerUpload
    ? { ...EMPTY_CAPABILITIES, view: true, upload_work: true, comment: true }
    : gallery.visibility === "server_public"
      ? { ...EMPTY_CAPABILITIES, view: true, comment: true }
      : { ...EMPTY_CAPABILITIES };

  const member = await db.prepare(
    `SELECT can_view, can_edit, can_upload_work, can_comment, can_manage_collaborators
     FROM gallery_members WHERE gallery_id = ? AND user_id = ?`,
  ).bind(galleryId, user.id).first<Record<string, number>>();

  if (member) {
    return {
      view: baseCaps.view || !!member.can_view,
      edit: baseCaps.edit || !!member.can_edit,
      upload_work: baseCaps.upload_work || !!member.can_upload_work,
      comment: baseCaps.comment || !!member.can_comment,
      manage_collaborators: baseCaps.manage_collaborators || !!member.can_manage_collaborators,
    };
  }

  return baseCaps;
}

async function getWork(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at IS NULL").bind(id).first<WorkRow>();
}

async function workGalleryLinks(db: D1Database, work: WorkRow) {
  const rows = await db.prepare(
    `SELECT galleries.id, galleries.title, galleries.visibility, galleries.ownership_type, galleries.whole_server_upload,
            work_galleries.created_at, work_galleries.updated_at
     FROM work_galleries
     JOIN galleries ON galleries.id = work_galleries.gallery_id
     WHERE work_galleries.work_id = ?
     ORDER BY work_galleries.updated_at DESC, galleries.title COLLATE NOCASE`,
  ).bind(work.id).all<GalleryRow & { created_at: string; updated_at: string }>();
  if (rows.results.length) return rows.results;
  const fallback = await db.prepare("SELECT *, created_at AS created_at, updated_at AS updated_at FROM galleries WHERE id = ?").bind(work.gallery_id).all<GalleryRow & { created_at: string; updated_at: string }>();
  return fallback.results;
}

async function workCapabilities(db: D1Database, user: AppUser, workId: string) {
  const work = await getWork(db, workId);
  if (!work) return { exists: false, work: null, caps: EMPTY_CAPABILITIES, version: false };
  const galleries = await workGalleryLinks(db, work);
  const galleryCapsList = await Promise.all(galleries.map((gallery) => galleryCapabilities(db, user, gallery.id)));
  const galleryCaps = galleryCapsList.reduce(
    (merged, caps) => ({
      view: merged.view || caps.view,
      edit: merged.edit || caps.edit,
      upload_work: merged.upload_work || caps.upload_work,
      comment: merged.comment || caps.comment,
      manage_collaborators: merged.manage_collaborators || caps.manage_collaborators,
    }),
    { ...EMPTY_CAPABILITIES },
  );
  const collab = await db.prepare(
    "SELECT can_edit, can_version, can_comment FROM work_collaborators WHERE work_id = ? AND user_id = ?",
  ).bind(workId, user.id).first<{ can_edit: number; can_version: number; can_comment: number }>();

  const caps = { ...galleryCaps };
  if (collab) {
    caps.view = true;
    caps.edit = caps.edit || !!collab.can_edit;
    caps.upload_work = caps.upload_work || !!collab.can_version;
    caps.comment = caps.comment || !!collab.can_comment;
  }

  if (work.created_by === user.id || user.role === "admin") {
    Object.assign(caps, OWNER_CAPABILITIES);
  }

  return { exists: true, work, caps, version: caps.edit || work.created_by === user.id || user.role === "admin" || !!collab?.can_version };
}

async function assertGalleryCapability(
  c: Ctx,
  galleryId: string,
  capability: keyof GalleryCapabilities,
) {
  const caps = await galleryCapabilities(c.env.DB, currentUser(c), galleryId);
  if (!caps[capability]) {
    return { ok: false as const, response: c.json({ error: "Forbidden" }, 403) };
  }
  return { ok: true as const, caps };
}

async function assertWorkCapability(
  c: Ctx,
  workId: string,
  capability: keyof GalleryCapabilities | "version",
) {
  const result = await workCapabilities(c.env.DB, currentUser(c), workId);
  if (!result.exists) return { ok: false as const, response: c.json({ error: "Not found" }, 404) };
  const allowed = capability === "version" ? result.version : result.caps[capability];
  if (!allowed) return { ok: false as const, response: c.json({ error: "Forbidden" }, 403) };
  return { ok: true as const, ...result };
}

async function canViewTarget(db: D1Database, user: AppUser, targetType: string, targetId: string): Promise<boolean> {
  if (targetType === "profile") {
    return !!(await db.prepare("SELECT id FROM users WHERE id = ? AND disabled_at IS NULL").bind(targetId).first());
  }
  if (targetType === "gallery") {
    return (await galleryCapabilities(db, user, targetId)).view;
  }
  if (targetType === "work") {
    return (await workCapabilities(db, user, targetId)).caps.view;
  }
  if (targetType === "version") {
    const row = await db.prepare("SELECT work_id FROM work_versions WHERE id = ?").bind(targetId).first<{ work_id: string }>();
    return row ? (await workCapabilities(db, user, row.work_id)).caps.view : false;
  }
  if (targetType === "comment") {
    const row = await db.prepare("SELECT target_type, target_id FROM comments WHERE id = ? AND deleted_at IS NULL").bind(targetId).first<{ target_type: string; target_id: string }>();
    return row ? canViewTarget(db, user, row.target_type, row.target_id) : false;
  }
  return false;
}

async function canCommentTarget(db: D1Database, user: AppUser, targetType: string, targetId: string): Promise<boolean> {
  if (targetType === "profile") return canViewTarget(db, user, targetType, targetId);
  if (targetType === "gallery") return (await galleryCapabilities(db, user, targetId)).comment;
  if (targetType === "work") return (await workCapabilities(db, user, targetId)).caps.comment;
  if (targetType === "version") {
    const row = await db.prepare("SELECT work_id FROM work_versions WHERE id = ?").bind(targetId).first<{ work_id: string }>();
    return row ? (await workCapabilities(db, user, row.work_id)).caps.comment : false;
  }
  if (targetType === "comment") return canViewTarget(db, user, targetType, targetId);
  return false;
}

async function insertEvent(
  env: Env,
  type: string,
  actorId: string | null,
  subjectType: string,
  subjectId: string,
  targetType: string | null = null,
  targetId: string | null = null,
  payload: Record<string, unknown> = {},
) {
  const id = ulid();
  const createdAt = now();
  await env.DB.prepare(
    `INSERT INTO domain_events
       (id, type, actor_id, subject_type, subject_id, target_type, target_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, type, actorId, subjectType, subjectId, targetType, targetId, jsonText(payload), createdAt).run();

  if (env.JOBS) {
    await env.JOBS.send({ kind: "process_event", eventId: id }).catch(() => processEvent(env, id));
  } else {
    await processEvent(env, id);
  }
  return id;
}

async function notify(env: Env, eventId: string, userId: string, type: string, body: string, actorId: string | null) {
  if (actorId && userId === actorId) return;
  await env.DB.prepare(
    "INSERT INTO notifications (id, user_id, event_id, type, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(ulid(), userId, eventId, type, body, now()).run();
}

async function linkedWorkCollaborators(db: D1Database, workId: string) {
  const rows = await db.prepare("SELECT DISTINCT user_id FROM work_collaborators WHERE work_id = ? AND user_id IS NOT NULL").bind(workId).all<{ user_id: string }>();
  return rows.results.map((row) => row.user_id);
}

async function galleryAttachedUsers(db: D1Database, galleryId: string) {
  const rows = await db.prepare("SELECT DISTINCT user_id FROM gallery_members WHERE gallery_id = ? AND can_view = 1").bind(galleryId).all<{ user_id: string }>();
  return rows.results.map((row) => row.user_id);
}

async function processEvent(env: Env, eventId: string) {
  const event = await env.DB.prepare("SELECT * FROM domain_events WHERE id = ?").bind(eventId).first<{
    id: string;
    type: string;
    actor_id: string | null;
    subject_type: string;
    subject_id: string;
    target_type: string | null;
    target_id: string | null;
    payload_json: string;
  }>();
  if (!event) return;

  const payload = parseJson<Record<string, unknown>>(event.payload_json, {});
  const targets = new Set<string>();
  let body = event.type.replace(/\./g, " ");

  if (event.type === "comment.created" && event.target_type === "work" && event.target_id) {
    const work = await getWork(env.DB, event.target_id);
    if (work) {
      targets.add(work.created_by);
      body = `New comment on ${work.title}`;
    }
  }

  if (event.type === "comment.created" && event.target_type === "version" && event.target_id) {
    const version = await env.DB.prepare(
      `SELECT works.created_by, works.title
       FROM work_versions JOIN works ON works.id = work_versions.work_id
       WHERE work_versions.id = ?`,
    ).bind(event.target_id).first<{ created_by: string; title: string }>();
    if (version) {
      targets.add(version.created_by);
      body = `New comment on ${version.title}`;
    }
  }

  if (event.type === "comment.replied") {
    const parentId = String(payload.parent_comment_id || "");
    const parent = await env.DB.prepare("SELECT author_id FROM comments WHERE id = ?").bind(parentId).first<{ author_id: string }>();
    if (parent) targets.add(parent.author_id);
    body = "New reply to your comment";
  }

  if ((event.type === "comment.created" || event.type === "comment.replied") && typeof payload.body === "string") {
    const handles = extractMentions(payload.body);
    if (handles.length) {
      const placeholders = handles.map(() => "?").join(",");
      const mentioned = await env.DB.prepare(
        `SELECT id FROM users WHERE disabled_at IS NULL AND lower(handle) IN (${placeholders})`,
      ).bind(...handles).all<{ id: string }>();
      for (const row of mentioned.results) targets.add(row.id);
      body = "You were mentioned in a comment";
    }
  }

  if (event.type === "work.collaborator_added" || event.type === "work.collaborator_updated") {
    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    if (userId) targets.add(userId);
    body = event.type === "work.collaborator_added" ? "You were added as a work collaborator" : "Your work collaborator credit was updated";
  }

  if (event.type === "work.version_created") {
    for (const userId of await linkedWorkCollaborators(env.DB, event.subject_id)) targets.add(userId);
    body = "A collaborative work has a new version";
  }

  if (event.type === "work.feedback_requested") {
    const work = await getWork(env.DB, event.subject_id);
    if (work) {
      for (const userId of await linkedWorkCollaborators(env.DB, work.id)) targets.add(userId);
      for (const userId of await galleryAttachedUsers(env.DB, work.gallery_id)) targets.add(userId);
      body = `Feedback requested on ${work.title}`;
    }
  }

  if (event.type === "reaction.created") {
    const targetType = String(payload.target_type || event.target_type || "");
    const targetId = String(payload.target_id || event.target_id || "");
    if (targetType === "work") {
      const work = await getWork(env.DB, targetId);
      if (work) {
        targets.add(work.created_by);
        body = `Someone liked your work "${work.title}"`;
      }
    }
    if (targetType === "comment") {
      const comment = await env.DB.prepare("SELECT author_id FROM comments WHERE id = ? AND deleted_at IS NULL").bind(targetId).first<{ author_id: string }>();
      if (comment) {
        targets.add(comment.author_id);
        body = "Someone liked your comment";
      }
    }
  }

  if (event.type === "invite.accepted") {
    const inviteId = String(payload.invite_id || "");
    const invite = await env.DB.prepare("SELECT created_by FROM invites WHERE id = ?").bind(inviteId).first<{ created_by: string }>();
    if (invite) targets.add(invite.created_by);
    const admins = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL").all<{ id: string }>();
    for (const admin of admins.results) targets.add(admin.id);
    body = "An invite was accepted";
  }

  if (event.type === "export.ready") {
    if (event.actor_id) targets.add(event.actor_id);
    body = "Your export is ready";
  }

  for (const userId of targets) {
    await notify(env, event.id, userId, event.type, body, event.actor_id);
  }

  await env.DB.prepare("UPDATE domain_events SET processed_at = ? WHERE id = ?").bind(now(), event.id).run();
}

async function serializeGallery(env: Env, user: AppUser, gallery: GalleryRow) {
  const pinned = await env.DB.prepare("SELECT pinned_at FROM user_gallery_pins WHERE user_id = ? AND gallery_id = ?")
    .bind(user.id, gallery.id)
    .first<{ pinned_at: string }>();
  let coverVersion = gallery.cover_version_id
    ? await env.DB.prepare(
      `SELECT work_versions.*
       FROM work_versions
       JOIN works ON works.id = work_versions.work_id
       JOIN work_galleries ON work_galleries.work_id = works.id
       WHERE work_versions.id = ? AND work_galleries.gallery_id = ? AND works.deleted_at IS NULL`,
    ).bind(gallery.cover_version_id, gallery.id).first<WorkVersionRow>()
    : null;
  if (!coverVersion && !gallery.cover_image_key) {
    coverVersion = await env.DB.prepare(
      `SELECT work_versions.*
       FROM works
       JOIN work_galleries ON work_galleries.work_id = works.id
       JOIN work_versions ON work_versions.id = works.current_version_id
       WHERE work_galleries.gallery_id = ? AND works.deleted_at IS NULL
       ORDER BY work_galleries.updated_at DESC, works.updated_at DESC
       LIMIT 1`,
    ).bind(gallery.id).first<WorkVersionRow>();
  }
  return {
    ...gallery,
    ownership_type: gallery.whole_server_upload ? "whole_server" : gallery.ownership_type,
    capabilities: await galleryCapabilities(env.DB, user, gallery.id),
    pinned: !!pinned,
    pinned_at: pinned?.pinned_at || null,
    cover_image_url: coverVersion?.thumbnail_r2_key
      ? (await signedMediaUrl(env, coverVersion.thumbnail_r2_key, coverVersion.thumbnail_content_type, "thumbnail")) || `/api/media/works/${coverVersion.work_id}/versions/${coverVersion.id}/thumbnail`
      : gallery.cover_image_key ? `/api/media/galleries/${gallery.id}/cover` : null,
  };
}

async function reactionSummary(db: D1Database, user: AppUser, targetType: "work" | "comment", targetId: string) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS count FROM reactions WHERE target_type = ? AND target_id = ? AND reaction = 'heart'",
  ).bind(targetType, targetId).first<{ count: number }>();
  const mine = await db.prepare(
    "SELECT id FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND reaction = 'heart'",
  ).bind(targetType, targetId, user.id).first<{ id: string }>();
  return {
    heart_count: row?.count || 0,
    hearted_by_me: !!mine,
  };
}

async function serializeWork(env: Env, user: AppUser, work: WorkRow) {
  const currentVersion = work.current_version_id
    ? await env.DB.prepare("SELECT * FROM work_versions WHERE id = ?").bind(work.current_version_id).first<WorkVersionRow>()
    : null;
  const caps = await workCapabilities(env.DB, user, work.id);
  const [reaction, feedbackDismissal, linkedGalleries] = await Promise.all([
    reactionSummary(env.DB, user, "work", work.id),
    env.DB.prepare("SELECT dismissed_at FROM feedback_request_dismissals WHERE work_id = ? AND user_id = ?").bind(work.id, user.id).first<{ dismissed_at: string }>(),
    workGalleryLinks(env.DB, work),
  ]);
  const galleries = [];
  for (const gallery of linkedGalleries) {
    const serialized = await serializeGallery(env, user, gallery);
    if (serialized.capabilities.view) galleries.push(serialized);
  }
  return {
    ...work,
    gallery_title: galleries[0]?.title || "",
    galleries,
    feedback_requested: !!work.feedback_requested,
    feedback_dismissed: !!feedbackDismissal,
    feedback_dismissed_at: feedbackDismissal?.dismissed_at || null,
    reactions: reaction,
    capabilities: caps.caps,
    can_create_version: caps.version,
    current_version: currentVersion ? await serializeVersion(env, currentVersion) : null,
  };
}

async function serializeVersion(env: Env, version: WorkVersionRow) {
  return {
    ...version,
    original_url: version.original_r2_key
      ? (await signedMediaUrl(env, version.original_r2_key, version.original_content_type, "original", version.original_filename)) || `/api/media/works/${version.work_id}/versions/${version.id}/original`
      : null,
    preview_url: version.preview_r2_key
      ? (await signedMediaUrl(env, version.preview_r2_key, version.preview_content_type, "preview")) || `/api/media/works/${version.work_id}/versions/${version.id}/preview`
      : null,
    thumbnail_url: version.thumbnail_r2_key
      ? (await signedMediaUrl(env, version.thumbnail_r2_key, version.thumbnail_content_type, "thumbnail")) || `/api/media/works/${version.work_id}/versions/${version.id}/thumbnail`
      : null,
  };
}

type GalleryWorkListRow = WorkRow & {
  version_id: string | null;
  version_work_id: string | null;
  version_number: number | null;
  body_markdown: string | null;
  body_plain: string | null;
  original_r2_key: string | null;
  original_content_type: string | null;
  preview_r2_key: string | null;
  preview_content_type: string | null;
  thumbnail_r2_key: string | null;
  thumbnail_content_type: string | null;
  original_filename: string | null;
  version_created_by: string | null;
  version_created_at: string | null;
  heart_count: number;
  hearted_by_me: number;
  feedback_dismissed_at: string | null;
};

async function serializeGalleryWorkListItem(env: Env, row: GalleryWorkListRow, caps: GalleryCapabilities) {
  const currentVersion = row.version_id ? await serializeVersion(env, {
    id: row.version_id,
    work_id: row.version_work_id || row.id,
    version_number: row.version_number || 1,
    body_markdown: row.body_markdown,
    body_plain: row.body_plain,
    original_r2_key: row.original_r2_key,
    original_content_type: row.original_content_type,
    preview_r2_key: row.preview_r2_key,
    preview_content_type: row.preview_content_type,
    thumbnail_r2_key: row.thumbnail_r2_key,
    thumbnail_content_type: row.thumbnail_content_type,
    original_filename: row.original_filename,
    created_by: row.version_created_by || row.created_by,
    created_at: row.version_created_at || row.created_at,
  }) : null;

  return {
    ...row,
    feedback_requested: !!row.feedback_requested,
    feedback_dismissed: !!row.feedback_dismissed_at,
    feedback_dismissed_at: row.feedback_dismissed_at,
    reactions: {
      heart_count: row.heart_count || 0,
      hearted_by_me: !!row.hearted_by_me,
    },
    capabilities: { ...caps, view: true },
    can_create_version: caps.upload_work || caps.edit,
    current_version: currentVersion,
  };
}

async function putR2File(bucket: R2Bucket, key: string, file: File, metadata: Record<string, string> = {}) {
  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: metadata,
  });
}

app.use("*", logger());
app.use("*", cors({
  origin: (origin) => {
    if (!origin) return null;
    try {
      const url = new URL(origin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost")) return origin;
    } catch {
      return null;
    }
    return origin;
  },
  credentials: true,
}));
app.use("*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/") && !c.req.path.startsWith("/api/media/")) {
    c.header("Cache-Control", "no-store");
  }
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
});

app.get("/api/health", (c) => c.json({ ok: true, service: "quietcollective" }));

app.get("/api/setup/status", async (c) => {
  const count = await adminCount(c.env.DB);
  const instance = await instanceInfo(c.env);
  return c.json({
    setup_required: count === 0,
    setup_enabled: count === 0,
    instance_name: instance.name,
    source_code_url: instance.source_code_url,
    logo_url: instance.logo_url,
  });
});

app.get("/api/instance", async (c) => c.json({ instance: await instanceInfo(c.env) }));

app.get("/api/instance/logo", async (c) => {
  const key = await getSetting<string | null>(c.env.DB, "logo_r2_key", null);
  const contentType = await getSetting<string | null>(c.env.DB, "logo_content_type", null);
  if (!key) return c.json({ error: "Not found" }, 404);
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": contentType || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "public, max-age=300",
    },
  });
});

app.post("/api/setup/admin", async (c) => {
  if (await adminCount(c.env.DB)) return c.json({ error: "Setup is disabled" }, 409);
  if (!c.env.ADMIN_SETUP_TOKEN) return c.json({ error: "ADMIN_SETUP_TOKEN is not configured" }, 500);

  const body = await readBody(c);
  if (stringField(body.token) !== c.env.ADMIN_SETUP_TOKEN) return c.json({ error: "Invalid setup token" }, 403);

  const email = stringField(body.email).toLowerCase();
  const password = stringField(body.password);
  const handle = normalizeHandle(stringField(body.handle || "admin")) || "admin";
  const displayName = handle;
  if (!email || !handle || password.length < 10) return c.json({ error: "Email, handle, and a password of at least 10 characters are required" }, 400);

  const id = ulid();
  const timestamp = now();
  const passwordHash = await bcrypt.hash(password, 10);
  await c.env.DB.prepare(
    `INSERT INTO users
       (id, email, password_hash, role, display_name, handle, bio, links_json, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', ?, ?, '', '[]', ?, ?)`,
  ).bind(id, email, passwordHash, displayName, handle, timestamp, timestamp).run();

  for (const role of ROLE_SUGGESTIONS) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO role_suggestions
         (id, scope, label, description, capabilities_json, sort_order, created_at, updated_at)
       VALUES (?, 'work_collaborator', ?, 'Common collaborator credit.', '{"edit":false,"version":false,"comment":true}', 100, ?, ?)`,
    ).bind(`work_${role}`, role, timestamp, timestamp).run().catch(() => undefined);
  }
  await c.env.DB.prepare(
    "UPDATE admin_bootstrap SET completed_by = ?, completed_at = ?, updated_at = ? WHERE id = 1",
  ).bind(id, timestamp, timestamp).run().catch(() => undefined);

  await insertEvent(c.env, "user.joined", id, "user", id);
  const token = await createSession(id, c.env);
  c.header("Set-Cookie", sessionCookie(token));
  const user = await getUserById(c.env.DB, id);
  return c.json({ user: publicUser(user!, []) }, 201);
});

app.post("/api/auth/login", async (c) => {
  const body = await readBody(c);
  const email = stringField(body.email).toLowerCase();
  const password = stringField(body.password);
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<AppUser & { password_hash: string }>();
  if (!user || user.disabled_at || !(await bcrypt.compare(password, user.password_hash))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const token = await createSession(user.id, c.env);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ token, user: publicUser(user, await getTags(c.env.DB, user.id)) });
});

app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", expiredSessionCookie());
  return c.json({ ok: true });
});

app.get("/api/auth/me", requireUser, async (c) => {
  const user = currentUser(c);
  return c.json({
    user: publicUser(user, await getTags(c.env.DB, user.id)),
    instance: await instanceInfo(c.env),
  });
});

app.get("/api/media/signed/:token", async (c) => {
  const payload = await readSignedMediaPayload(c.env, c.req.param("token"));
  if (!payload) return c.json({ error: "Forbidden" }, 403);
  const object = await c.env.MEDIA.get(payload.key);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": payload.content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": cacheControl(payload.variant),
      "content-disposition": payload.variant === "original" && payload.filename ? `attachment; filename="${payload.filename.replace(/"/g, "")}"` : "inline",
    },
  });
});

app.use("/api/admin/*", requireUser);
app.use("/api/members", requireUser);
app.use("/api/users/*", requireUser);
app.use("/api/galleries", requireUser);
app.use("/api/galleries/*", requireUser);
app.use("/api/works/*", requireUser);
app.use("/api/role-suggestions", requireUser);
app.use("/api/reactions/*", requireUser);
app.use("/api/markdown-assets", requireUser);
app.use("/api/comments", requireUser);
app.use("/api/comments/*", requireUser);
app.use("/api/activity", requireUser);
app.use("/api/tags/*", requireUser);
app.use("/api/notifications*", requireUser);
app.use("/api/exports*", requireUser);
app.use("/api/media/*", requireUser);

async function requireAdmin(c: Ctx) {
  if (currentUser(c).role !== "admin") {
    return { ok: false as const, response: c.json({ error: "Admin access required" }, 403) };
  }
  return { ok: true as const };
}

app.get("/api/admin", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const [members, invites, events] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NULL").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM invites WHERE revoked_at IS NULL").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM domain_events").first<{ count: number }>(),
  ]);
  return c.json({
    setup_enabled: (await adminCount(c.env.DB)) === 0,
    members: members?.count || 0,
    active_invites: invites?.count || 0,
    events: events?.count || 0,
    ...(await instanceInfo(c.env)),
  });
});

app.get("/api/admin/events", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const rows = await c.env.DB.prepare("SELECT * FROM domain_events ORDER BY created_at DESC LIMIT 100").all();
  return c.json({ events: rows.results });
});

app.get("/api/admin/settings", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const rows = await c.env.DB.prepare("SELECT key, value_json, updated_at FROM instance_settings ORDER BY key").all();
  return c.json({
    ...(await instanceInfo(c.env)),
    settings: rows.results,
  });
});

app.post("/api/admin/settings", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const user = currentUser(c);
  const body = await readBody(c);
  const instanceName = stringField(body.instance_name || body.instanceName);
  const sourceCodeUrl = stringField(body.source_code_url || body.sourceCodeUrl);
  const logo = fileField(body.logo);

  if (instanceName) {
    await setSetting(c.env.DB, "instance_name", instanceName, user.id, "Display name for this community instance.");
  }
  await setSetting(c.env.DB, "source_code_url", sourceCodeUrl, user.id, "AGPL source URL displayed in the app.");

  if (logo) {
    const key = `instance/logo/${ulid()}-${logo.name || "logo"}`;
    await putR2File(c.env.MEDIA, key, logo, { kind: "instance_logo" });
    await setSetting(c.env.DB, "logo_r2_key", key, user.id, "Optional custom instance logo stored in private R2.");
    await setSetting(c.env.DB, "logo_content_type", logo.type || "application/octet-stream", user.id, "Content type for the custom instance logo.");
  }

  await insertEvent(c.env, "instance.settings_updated", user.id, "instance", "settings");
  return c.json({ instance: await instanceInfo(c.env) });
});

app.post("/api/admin/users/:id/disable", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const id = c.req.param("id");
  if (id === currentUser(c).id) return c.json({ error: "You cannot disable yourself" }, 400);
  await c.env.DB.prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), id).run();
  await insertEvent(c.env, "user.disabled", currentUser(c).id, "user", id);
  return c.json({ ok: true });
});

app.post("/api/admin/invites", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const body = await readBody(c);
  const token = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const id = ulid();
  const timestamp = now();
  const role = stringField(body.role_on_join || body.roleOnJoin || "member") === "admin" ? "admin" : "member";
  const maxUses = Math.max(1, Math.min(100, Math.floor(numberField(body.max_uses || body.maxUses, 1))));
  const expiresAt = stringField(body.expires_at || body.expiresAt, "") || null;
  await c.env.DB.prepare(
    `INSERT INTO invites
       (id, token_hash, created_by, role_on_join, max_uses, use_count, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).bind(id, await sha256(token), currentUser(c).id, role, maxUses, expiresAt, timestamp, timestamp).run();
  await insertEvent(c.env, "invite.created", currentUser(c).id, "invite", id);
  return c.json({ invite: { id, token, role_on_join: role, max_uses: maxUses, expires_at: expiresAt, url: `/invite/${token}` } }, 201);
});

app.get("/api/admin/invites", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const rows = await c.env.DB.prepare(
    `SELECT invites.*, users.display_name AS created_by_name
     FROM invites JOIN users ON users.id = invites.created_by
     ORDER BY invites.created_at DESC`,
  ).all();
  return c.json({ invites: rows.results });
});

app.post("/api/admin/invites/:id/revoke", async (c) => {
  const admin = await requireAdmin(c);
  if (!admin.ok) return admin.response;
  const id = c.req.param("id");
  await c.env.DB.prepare("UPDATE invites SET revoked_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), id).run();
  await insertEvent(c.env, "invite.revoked", currentUser(c).id, "invite", id);
  return c.json({ ok: true });
});

async function inviteFromToken(db: D1Database, token: string) {
  return db.prepare("SELECT * FROM invites WHERE token_hash = ?").bind(await sha256(token)).first<{
    id: string;
    created_by: string;
    role_on_join: string;
    max_uses: number;
    use_count: number;
    expires_at: string | null;
    revoked_at: string | null;
  }>();
}

function inviteUsable(invite: Awaited<ReturnType<typeof inviteFromToken>>) {
  if (!invite) return false;
  if (invite.revoked_at) return false;
  if (invite.use_count >= invite.max_uses) return false;
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) return false;
  return true;
}

function inviteExpiredOrRevoked(invite: Awaited<ReturnType<typeof inviteFromToken>>) {
  if (!invite) return true;
  if (invite.revoked_at) return true;
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) return true;
  return false;
}

function inviteAcceptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("UNIQUE constraint failed: users.email") || message.includes("UNIQUE constraint failed: users.handle")) {
    return { message: "Email or handle is already in use. Try logging in.", status: 409 };
  }
  if (message.includes("CHECK constraint failed: use_count <= max_uses")) {
    return { message: "Invite is no longer available.", status: 409 };
  }
  console.error("invite accept failed", error);
  return { message: "Could not accept invite.", status: 500 };
}

app.get("/api/invites/:token", async (c) => {
  const invite = await inviteFromToken(c.env.DB, c.req.param("token"));
  if (!invite || !inviteUsable(invite)) return c.json({ valid: false }, 404);
  return c.json({
    valid: true,
    role_on_join: invite.role_on_join,
    expires_at: invite.expires_at,
    uses_remaining: invite.max_uses - invite.use_count,
    instance_name: (await instanceInfo(c.env)).name,
  });
});

app.post("/api/invites/:token/accept", async (c) => {
  const invite = await inviteFromToken(c.env.DB, c.req.param("token"));
  if (inviteExpiredOrRevoked(invite)) return c.json({ error: "Invite is not available" }, 404);
  const body = await readBody(c);
  const email = stringField(body.email).toLowerCase();
  const password = stringField(body.password);
  const handle = normalizeHandle(stringField(body.handle));
  const displayName = handle;
  if (!email || !handle || password.length < 10) {
    return c.json({ error: "Email, handle, and a password of at least 10 characters are required" }, 400);
  }

  const existingUsers = await c.env.DB.prepare("SELECT * FROM users WHERE email = ? OR handle = ?")
    .bind(email, handle)
    .all<AppUser & { password_hash: string }>();
  const exactExistingUser = existingUsers.results.find((user) => user.email === email && user.handle === handle && !user.disabled_at);
  if (exactExistingUser && existingUsers.results.length === 1) {
    const acceptance = await c.env.DB.prepare("SELECT id FROM invite_acceptances WHERE invite_id = ? AND accepted_by = ?")
      .bind(invite!.id, exactExistingUser.id)
      .first<{ id: string }>();
    if (acceptance && await bcrypt.compare(password, exactExistingUser.password_hash)) {
      const session = await createSession(exactExistingUser.id, c.env);
      c.header("Set-Cookie", sessionCookie(session));
      return c.json({ token: session, user: publicUser(exactExistingUser, await getTags(c.env.DB, exactExistingUser.id)), duplicate: true });
    }
  }
  if (existingUsers.results.length) {
    return c.json({ error: "Email or handle is already in use. Try logging in." }, 409);
  }

  if (!inviteUsable(invite)) return c.json({ error: "Invite is not available" }, 404);

  const id = ulid();
  const timestamp = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users
           (id, email, password_hash, role, display_name, handle, bio, links_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)`,
      ).bind(id, email, await bcrypt.hash(password, 10), invite!.role_on_join, displayName, handle, timestamp, timestamp),
      c.env.DB.prepare("UPDATE invites SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, invite!.id),
      c.env.DB.prepare(
        "INSERT INTO invite_acceptances (id, invite_id, accepted_by, accepted_email, role_granted, accepted_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(ulid(), invite!.id, id, email, invite!.role_on_join, timestamp),
    ]);
  } catch (error) {
    const acceptError = inviteAcceptError(error);
    return c.json({ error: acceptError.message }, acceptError.status as 409 | 500);
  }

  await insertEvent(c.env, "user.joined", id, "user", id).catch((error) => console.error("user.joined event failed", error));
  await insertEvent(c.env, "invite.accepted", id, "invite", invite!.id, "user", id, { invite_id: invite!.id }).catch((error) => console.error("invite.accepted event failed", error));
  const session = await createSession(id, c.env);
  c.header("Set-Cookie", sessionCookie(session));
  return c.json({ token: session, user: publicUser((await getUserById(c.env.DB, id))!, []) }, 201);
});

app.get("/api/members", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM users WHERE disabled_at IS NULL ORDER BY handle COLLATE NOCASE").all<AppUser>();
  const members = [];
  for (const user of rows.results) members.push(publicUser(user, await getTags(c.env.DB, user.id)));
  return c.json({ members });
});

app.get("/api/users/:handle", async (c) => {
  const handle = normalizeHandle(c.req.param("handle"));
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE handle = ? AND disabled_at IS NULL").bind(handle).first<AppUser>();
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json({ user: publicUser(user, await getTags(c.env.DB, user.id)) });
});

app.patch("/api/users/me", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const handle = normalizeHandle(stringField(body.handle || user.handle));
  const displayName = handle;
  const bio = stringField(body.bio || "");
  const links = Array.isArray(body.links) ? body.links : parseJson(String(body.links_json || body.links || "[]"), []);
  await c.env.DB.prepare(
    "UPDATE users SET display_name = ?, handle = ?, bio = ?, links_json = ?, updated_at = ? WHERE id = ?",
  ).bind(displayName, handle, bio, jsonText(links), now(), user.id).run();
  await insertEvent(c.env, "profile.updated", user.id, "profile", user.id);
  const updated = await getUserById(c.env.DB, user.id);
  return c.json({ user: publicUser(updated!, await getTags(c.env.DB, user.id)) });
});

app.post("/api/users/me/profile-image", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const file = fileField(body.image || body.file || body.profile_image);
  if (!file) return c.json({ error: "Profile image file is required" }, 400);
  const key = `users/${user.id}/profile/${ulid()}-${file.name || "profile"}`;
  await putR2File(c.env.MEDIA, key, file, { owner: user.id, kind: "profile_image" });
  await c.env.DB.prepare(
    "UPDATE users SET profile_image_key = ?, profile_image_content_type = ?, updated_at = ? WHERE id = ?",
  ).bind(key, file.type || "application/octet-stream", now(), user.id).run();
  await insertEvent(c.env, "profile.updated", user.id, "profile", user.id);
  return c.json({ profile_image_url: `/api/media/users/${user.id}/profile` });
});

app.post("/api/users/me/avatar-crop", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const file = fileField(body.avatar || body.image || body.file);
  const crop = typeof body.crop === "string" ? parseJson(body.crop, {}) : (body.crop || {});
  let key = user.avatar_key;
  let contentType = user.avatar_content_type;
  if (file) {
    key = `users/${user.id}/avatar/${ulid()}-${file.name || "avatar"}`;
    contentType = file.type || "application/octet-stream";
    await putR2File(c.env.MEDIA, key, file, { owner: user.id, kind: "avatar" });
  }
  await c.env.DB.prepare(
    "UPDATE users SET avatar_key = ?, avatar_content_type = ?, avatar_crop_json = ?, updated_at = ? WHERE id = ?",
  ).bind(key, contentType, jsonText(crop), now(), user.id).run();
  await insertEvent(c.env, "profile.updated", user.id, "profile", user.id);
  return c.json({ avatar_url: key ? `/api/media/users/${user.id}/avatar` : null, avatar_crop: crop });
});

app.post("/api/users/me/medium-tags", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(","))
    .map((tag: unknown) => stringField(tag).toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
  await c.env.DB.prepare("DELETE FROM medium_tags WHERE user_id = ?").bind(user.id).run();
  for (const tag of [...new Set(tags)]) {
    await c.env.DB.prepare("INSERT INTO medium_tags (user_id, tag, created_at) VALUES (?, ?, ?)").bind(user.id, tag, now()).run();
  }
  await insertEvent(c.env, "profile.updated", user.id, "profile", user.id);
  return c.json({ medium_tags: [...new Set(tags)] });
});

app.post("/api/markdown-assets", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const file = fileField(body.file || body.image);
  if (!file) return c.json({ error: "Image file is required" }, 400);
  if (!file.type.startsWith("image/")) return c.json({ error: "Only image uploads are supported" }, 415);
  const targetType = stringField(body.target_type || body.targetType || "draft").slice(0, 40) || "draft";
  const targetId = stringField(body.target_id || body.targetId, "") || null;
  if (targetId && targetType !== "draft" && !(await canViewTarget(c.env.DB, user, targetType, targetId))) return c.json({ error: "Forbidden" }, 403);
  const id = ulid();
  const key = `markdown-assets/${user.id}/${id}/${file.name || "image"}`;
  const timestamp = now();
  await putR2File(c.env.MEDIA, key, file, { owner: user.id, kind: "markdown_asset", target_type: targetType, target_id: targetId || "" });
  await c.env.DB.prepare(
    `INSERT INTO markdown_assets
       (id, owner_user_id, target_type, target_id, r2_key, content_type, original_filename, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, user.id, targetType, targetId, key, file.type || "application/octet-stream", file.name || "image", timestamp).run();
  return c.json({ url: `/api/media/markdown-assets/${id}`, data: { filePath: `/api/media/markdown-assets/${id}` } }, 201);
});

app.get("/api/role-suggestions", async (c) => {
  const scope = stringField(c.req.query("scope") || "work_collaborator") === "gallery_member" ? "gallery_member" : "work_collaborator";
  const rows = await c.env.DB.prepare(
    `SELECT id, scope, label, description, capabilities_json, sort_order
     FROM role_suggestions
     WHERE scope = ? AND is_active = 1
     ORDER BY sort_order, lower(label)`,
  ).bind(scope).all();
  return c.json({ roles: rows.results });
});

app.post("/api/galleries", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const id = ulid();
  const timestamp = now();
  const title = stringField(body.title);
  if (!title) return c.json({ error: "Title is required" }, 400);
  const requestedOwnership = normalizeGalleryOwnership(body.ownership_type || body.ownershipType || "self");
  const wholeServerUpload = requestedOwnership === "whole_server";
  const ownership = wholeServerUpload ? "collaborative" : requestedOwnership;
  const visibility = wholeServerUpload || stringField(body.visibility || "private") === "server_public" ? "server_public" : "private";
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO galleries
         (id, owner_user_id, ownership_type, visibility, title, description, whole_server_upload, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, ownership, visibility, title, stringField(body.description), wholeServerUpload ? 1 : 0, user.id, timestamp, timestamp),
    c.env.DB.prepare(
      `INSERT INTO gallery_members
         (gallery_id, user_id, role_label, can_view, can_edit, can_upload_work, can_comment, can_manage_collaborators, created_at, updated_at)
       VALUES (?, ?, 'owner', 1, 1, 1, 1, 1, ?, ?)`,
    ).bind(id, user.id, timestamp, timestamp),
  ]);
  await insertEvent(c.env, "gallery.created", user.id, "gallery", id);
  const gallery = await c.env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(id).first<GalleryRow>();
  return c.json({ gallery: await serializeGallery(c.env, user, gallery!) }, 201);
});

app.get("/api/galleries", async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare("SELECT * FROM galleries ORDER BY updated_at DESC LIMIT 200").all<GalleryRow>();
  const galleries = [];
  for (const gallery of rows.results) {
    const serialized = await serializeGallery(c.env, user, gallery);
    if (serialized.capabilities.view) galleries.push(serialized);
  }
  return c.json({ galleries });
});

app.post("/api/galleries/:id/pin", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "view");
  if (!gate.ok) return gate.response;
  const user = currentUser(c);
  await c.env.DB.prepare(
    `INSERT INTO user_gallery_pins (user_id, gallery_id, sort_order, pinned_at)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id, gallery_id) DO UPDATE SET pinned_at = excluded.pinned_at`,
  ).bind(user.id, id, now()).run();
  return c.json({ ok: true, pinned: true });
});

app.delete("/api/galleries/:id/pin", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "view");
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare("DELETE FROM user_gallery_pins WHERE user_id = ? AND gallery_id = ?").bind(currentUser(c).id, id).run();
  return c.json({ ok: true, pinned: false });
});

app.get("/api/galleries/:id", async (c) => {
  const gate = await assertGalleryCapability(c, c.req.param("id"), "view");
  if (!gate.ok) return gate.response;
  const user = currentUser(c);
  const gallery = await c.env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(c.req.param("id")).first<GalleryRow>();
  if (!gallery) return c.json({ error: "Not found" }, 404);
  const [members, works] = await Promise.all([
    c.env.DB.prepare(
      `SELECT gallery_members.*, users.display_name, users.handle
       FROM gallery_members JOIN users ON users.id = gallery_members.user_id
       WHERE gallery_id = ? ORDER BY users.handle COLLATE NOCASE`,
    ).bind(gallery.id).all(),
    c.env.DB.prepare(
      `SELECT works.*,
              work_versions.id AS version_id,
              work_versions.work_id AS version_work_id,
              work_versions.version_number AS version_number,
              work_versions.body_markdown AS body_markdown,
              work_versions.body_plain AS body_plain,
              work_versions.original_r2_key AS original_r2_key,
              work_versions.original_content_type AS original_content_type,
              work_versions.preview_r2_key AS preview_r2_key,
              work_versions.preview_content_type AS preview_content_type,
              work_versions.thumbnail_r2_key AS thumbnail_r2_key,
              work_versions.thumbnail_content_type AS thumbnail_content_type,
              work_versions.original_filename AS original_filename,
              work_versions.created_by AS version_created_by,
              work_versions.created_at AS version_created_at,
              COUNT(reactions.id) AS heart_count,
              MAX(CASE WHEN reactions.user_id = ? THEN 1 ELSE 0 END) AS hearted_by_me,
              feedback_request_dismissals.dismissed_at AS feedback_dismissed_at
       FROM works
       JOIN work_galleries ON work_galleries.work_id = works.id
       LEFT JOIN work_versions ON work_versions.id = works.current_version_id
       LEFT JOIN reactions ON reactions.target_type = 'work'
         AND reactions.target_id = works.id
         AND reactions.reaction = 'heart'
       LEFT JOIN feedback_request_dismissals ON feedback_request_dismissals.work_id = works.id
         AND feedback_request_dismissals.user_id = ?
       WHERE work_galleries.gallery_id = ? AND works.deleted_at IS NULL
       GROUP BY works.id
       ORDER BY work_galleries.updated_at DESC, works.updated_at DESC`,
    ).bind(user.id, user.id, gallery.id).all<GalleryWorkListRow>(),
  ]);
  return c.json({
    gallery: await serializeGallery(c.env, user, gallery),
    members: members.results,
    works: await Promise.all(works.results.map((work) => serializeGalleryWorkListItem(c.env, work, gate.caps))),
  });
});

app.patch("/api/galleries/:id", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "edit");
  if (!gate.ok) return gate.response;
  const before = await c.env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(id).first<GalleryRow>();
  if (!before) return c.json({ error: "Not found" }, 404);
  const body = await readBody(c);
  const title = stringField(body.title || before.title);
  const description = stringField(body.description ?? before.description);
  const requestedOwnership = normalizeGalleryOwnership(body.ownership_type || body.ownershipType || (before.whole_server_upload ? "whole_server" : before.ownership_type));
  const wholeServerUpload = requestedOwnership === "whole_server";
  const ownership = wholeServerUpload ? "collaborative" : requestedOwnership;
  const visibility = wholeServerUpload || stringField(body.visibility || before.visibility) === "server_public" ? "server_public" : "private";
  const coverVersionId = stringField(body.cover_version_id || body.coverVersionId, "");
  let coverWorkId = before.cover_work_id || null;
  let coverVersion = before.cover_version_id || null;
  if (coverVersionId) {
    const version = await c.env.DB.prepare(
      `SELECT work_versions.id, work_versions.work_id
       FROM work_versions JOIN works ON works.id = work_versions.work_id
       WHERE work_versions.id = ? AND works.gallery_id = ? AND works.deleted_at IS NULL`,
    ).bind(coverVersionId, id).first<{ id: string; work_id: string }>();
    if (!version) return c.json({ error: "Cover version must belong to this gallery" }, 400);
    coverWorkId = version.work_id;
    coverVersion = version.id;
  }
  await c.env.DB.prepare(
    "UPDATE galleries SET title = ?, description = ?, ownership_type = ?, visibility = ?, whole_server_upload = ?, cover_work_id = ?, cover_version_id = ?, updated_at = ? WHERE id = ?",
  ).bind(title, description, ownership, visibility, wholeServerUpload ? 1 : 0, coverWorkId, coverVersion, now(), id).run();
  await insertEvent(c.env, "gallery.updated", currentUser(c).id, "gallery", id, null, null, {
    title,
    previous_title: before.title,
    description_changed: description !== before.description,
  });
  if (visibility !== before.visibility) await insertEvent(c.env, "gallery.visibility_changed", currentUser(c).id, "gallery", id, null, null, { from: before.visibility, to: visibility });
  const gallery = await c.env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(id).first<GalleryRow>();
  return c.json({ gallery: await serializeGallery(c.env, currentUser(c), gallery!) });
});

app.delete("/api/galleries/:id", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "manage_collaborators");
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare("DELETE FROM galleries WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

app.post("/api/galleries/:id/members", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "manage_collaborators");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  const handle = normalizeHandle(stringField(body.handle));
  const userId = stringField(body.user_id || body.userId) || (handle ? (await c.env.DB.prepare("SELECT id FROM users WHERE handle = ?").bind(handle).first<{ id: string }>())?.id : "");
  if (!userId) return c.json({ error: "Member user is required" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO gallery_members
       (gallery_id, user_id, role_label, can_view, can_edit, can_upload_work, can_comment, can_manage_collaborators, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(gallery_id, user_id) DO UPDATE SET
       role_label = excluded.role_label,
       can_view = excluded.can_view,
       can_edit = excluded.can_edit,
       can_upload_work = excluded.can_upload_work,
       can_comment = excluded.can_comment,
       can_manage_collaborators = excluded.can_manage_collaborators,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    userId,
    stringField(body.role_label || body.roleLabel || "member"),
    truthy(body.can_view ?? body.view) ? 1 : 1,
    truthy(body.can_edit ?? body.edit) ? 1 : 0,
    truthy(body.can_upload_work ?? body.upload_work) ? 1 : 0,
    truthy(body.can_comment ?? body.comment) ? 1 : 1,
    truthy(body.can_manage_collaborators ?? body.manage_collaborators) ? 1 : 0,
    now(),
    now(),
  ).run();
  await insertEvent(c.env, "gallery.member_added", currentUser(c).id, "gallery", id, "user", userId, { user_id: userId });
  return c.json({ ok: true }, 201);
});

app.patch("/api/galleries/:id/members/:userId", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "manage_collaborators");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  await c.env.DB.prepare(
    `UPDATE gallery_members
     SET role_label = COALESCE(?, role_label),
         can_view = COALESCE(?, can_view),
         can_edit = COALESCE(?, can_edit),
         can_upload_work = COALESCE(?, can_upload_work),
         can_comment = COALESCE(?, can_comment),
         can_manage_collaborators = COALESCE(?, can_manage_collaborators),
         updated_at = ?
     WHERE gallery_id = ? AND user_id = ?`,
  ).bind(
    stringField(body.role_label || body.roleLabel, "") || null,
    body.can_view == null ? null : (truthy(body.can_view) ? 1 : 0),
    body.can_edit == null ? null : (truthy(body.can_edit) ? 1 : 0),
    body.can_upload_work == null ? null : (truthy(body.can_upload_work) ? 1 : 0),
    body.can_comment == null ? null : (truthy(body.can_comment) ? 1 : 0),
    body.can_manage_collaborators == null ? null : (truthy(body.can_manage_collaborators) ? 1 : 0),
    now(),
    id,
    c.req.param("userId"),
  ).run();
  await insertEvent(c.env, "gallery.updated", currentUser(c).id, "gallery", id);
  return c.json({ ok: true });
});

app.delete("/api/galleries/:id/members/:userId", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "manage_collaborators");
  if (!gate.ok) return gate.response;
  const userId = c.req.param("userId");
  await c.env.DB.prepare("DELETE FROM gallery_members WHERE gallery_id = ? AND user_id = ?").bind(id, userId).run();
  await insertEvent(c.env, "gallery.member_removed", currentUser(c).id, "gallery", id, "user", userId, { user_id: userId });
  return c.json({ ok: true });
});

async function createWorkVersion(c: Ctx, work: WorkRow, body: Record<string, unknown>) {
  const user = currentUser(c);
  const current = await c.env.DB.prepare("SELECT MAX(version_number) AS max FROM work_versions WHERE work_id = ?").bind(work.id).first<{ max: number | null }>();
  const versionNumber = (current?.max || 0) + 1;
  const id = ulid();
  const timestamp = now();
  const file = fileField(body.file || body.image);
  let originalKey: string | null = null;
  let previewKey: string | null = null;
  let thumbnailKey: string | null = null;
  let originalType: string | null = null;
  let previewType: string | null = null;
  let thumbnailType: string | null = null;
  let originalFilename: string | null = null;

  if (work.type === "image") {
    if (!file) throw new Error("Image file is required");
    const previewFile = fileField(body.preview || body.preview_file || body.previewFile) || file;
    const thumbnailFile = fileField(body.thumbnail || body.thumbnail_file || body.thumbnailFile) || previewFile;
    const base = `works/${work.id}/versions/${id}`;
    originalKey = `${base}/original-${file.name || "image"}`;
    previewKey = `${base}/preview-${previewFile.name || file.name || "image"}`;
    thumbnailKey = `${base}/thumbnail-${thumbnailFile.name || previewFile.name || file.name || "image"}`;
    originalType = file.type || "application/octet-stream";
    previewType = previewFile.type || originalType;
    thumbnailType = thumbnailFile.type || previewType;
    originalFilename = file.name || "image";
    await putR2File(c.env.MEDIA, originalKey, file, { owner: work.created_by, work: work.id, variant: "original" });
    await putR2File(c.env.MEDIA, previewKey, previewFile, { owner: work.created_by, work: work.id, variant: "preview" });
    await putR2File(c.env.MEDIA, thumbnailKey, thumbnailFile, { owner: work.created_by, work: work.id, variant: "thumbnail" });
  }

  await c.env.DB.prepare(
    `INSERT INTO work_versions
       (id, work_id, version_number, body_markdown, body_plain, original_r2_key, original_content_type,
        preview_r2_key, preview_content_type, thumbnail_r2_key, thumbnail_content_type, original_filename, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    work.id,
    versionNumber,
    work.type === "writing" ? stringField(body.body_markdown || body.markdown || body.body) : null,
    work.type === "writing" ? stringField(body.body_plain || body.plain_text || body.body) : null,
    originalKey,
    originalType,
    previewKey,
    previewType || originalType,
    thumbnailKey,
    thumbnailType || previewType || originalType,
    originalFilename,
    user.id,
    timestamp,
  ).run();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE works SET current_version_id = ?, updated_at = ? WHERE id = ?").bind(id, timestamp, work.id),
    c.env.DB.prepare("UPDATE work_galleries SET updated_at = ? WHERE work_id = ?").bind(timestamp, work.id),
    c.env.DB.prepare("UPDATE galleries SET updated_at = ? WHERE id IN (SELECT gallery_id FROM work_galleries WHERE work_id = ?)").bind(timestamp, work.id),
  ]);
  await insertEvent(c.env, "work.version_created", user.id, "work", work.id, "version", id, { version_id: id });
  return (await c.env.DB.prepare("SELECT * FROM work_versions WHERE id = ?").bind(id).first<WorkVersionRow>())!;
}

function collaboratorInputsFromBody(body: Record<string, unknown>) {
  const raw = stringField(body.collaborators_json || body.collaboratorsJson, "");
  const parsed = raw ? parseJson<unknown>(raw, []) : [];
  return Array.isArray(parsed) ? parsed.filter((item): item is WorkCollaboratorInput => !!item && typeof item === "object") : [];
}

async function createWorkCollaborator(c: Ctx, workId: string, body: WorkCollaboratorInput): Promise<WorkCollaboratorResult> {
  const userText = stringField(body.user || body.collaborator_user || body.collaboratorUser || body.display_name || body.displayName);
  let linkedUserId = stringField(body.user_id || body.userId, "") || null;
  let linkedUser: AppUser | null = linkedUserId ? (await getUserById(c.env.DB, linkedUserId)) || null : null;
  if (!linkedUser && userText.startsWith("@")) {
    linkedUser = (await getUserByHandle(c.env.DB, userText.slice(1))) || null;
    linkedUserId = linkedUser?.id || null;
  }

  const displayName = linkedUser?.handle || userText;
  if (!displayName) return { ok: false, error: "User or collaborator name is required" };

  const roleLabel = normalizeRoleLabel(stringField(body.role_label || body.roleLabel || "collaborator")) || "collaborator";
  const roleSuggestionId = await ensureWorkRoleSuggestion(c.env.DB, roleLabel, currentUser(c).id);
  const creditOrder = Math.floor(numberField(body.credit_order || body.creditOrder, 0));
  const timestamp = now();

  if (linkedUserId) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM work_collaborators WHERE work_id = ? AND user_id = ?",
    ).bind(workId, linkedUserId).first<{ id: string }>();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE work_collaborators
         SET display_name = ?, role_suggestion_id = ?, role_label = ?, credit_order = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(displayName, roleSuggestionId, roleLabel, creditOrder, timestamp, existing.id).run();
      await insertEvent(c.env, "work.collaborator_updated", currentUser(c).id, "work", workId, "work_collaborator", existing.id, { collaborator_id: existing.id, user_id: linkedUserId });
      return { ok: true, id: existing.id, display_name: displayName, user_id: linkedUserId, role_label: roleLabel, duplicate: true };
    }
  }

  const id = ulid();
  try {
    await c.env.DB.prepare(
      `INSERT INTO work_collaborators
         (id, work_id, display_name, user_id, role_suggestion_id, role_label, credit_order, notes, can_edit, can_version, can_comment, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
    ).bind(
      id,
      workId,
      displayName,
      linkedUserId,
      roleSuggestionId,
      roleLabel,
      creditOrder,
      "",
      currentUser(c).id,
      timestamp,
      timestamp,
    ).run();
  } catch (error) {
    if (linkedUserId) {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM work_collaborators WHERE work_id = ? AND user_id = ?",
      ).bind(workId, linkedUserId).first<{ id: string }>();
      if (existing) return { ok: true, id: existing.id, display_name: displayName, user_id: linkedUserId, role_label: roleLabel, duplicate: true };
    }
    return { ok: false, display_name: displayName, user_id: linkedUserId, role_label: roleLabel, error: error instanceof Error ? error.message : "Could not add collaborator" };
  }

  await insertEvent(c.env, "work.collaborator_added", currentUser(c).id, "work", workId, "work_collaborator", id, { collaborator_id: id, user_id: linkedUserId });
  return { ok: true, id, display_name: displayName, user_id: linkedUserId, role_label: roleLabel };
}

app.post("/api/galleries/:galleryId/works", async (c) => {
  const galleryId = c.req.param("galleryId");
  const gate = await assertGalleryCapability(c, galleryId, "upload_work");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  const type = "image";
  const file = fileField(body.file || body.image);
  const title = stringField(body.title) || (file?.name ? file.name.replace(/\.[^.]+$/, "") : "Untitled image");
  const user = currentUser(c);
  const clientUploadKey = normalizeClientUploadKey(stringField(body.client_upload_key || body.clientUploadKey, ""));
  if (clientUploadKey) {
    const existing = await c.env.DB.prepare(
      "SELECT * FROM works WHERE created_by = ? AND client_upload_key = ? AND deleted_at IS NULL",
    ).bind(user.id, clientUploadKey).first<WorkRow>();
    if (existing) {
      return c.json({ work: await serializeWork(c.env, user, existing), duplicate: true, collaborator_results: [] });
    }
  }

  const id = ulid();
  const timestamp = now();
  const collaboratorInputs = collaboratorInputsFromBody(body);
  try {
    await c.env.DB.prepare(
    `INSERT INTO works
       (id, gallery_id, type, title, description, content_warning, feedback_requested, feedback_prompt, created_by, created_at, updated_at, client_upload_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      galleryId,
      type,
      title,
      stringField(body.description),
      null,
      0,
      null,
      user.id,
      timestamp,
      timestamp,
      clientUploadKey || null,
    ).run();
  } catch (error) {
    if (clientUploadKey) {
      const existing = await c.env.DB.prepare(
        "SELECT * FROM works WHERE created_by = ? AND client_upload_key = ? AND deleted_at IS NULL",
      ).bind(user.id, clientUploadKey).first<WorkRow>();
      if (existing) return c.json({ work: await serializeWork(c.env, user, existing), duplicate: true, collaborator_results: [] });
    }
    return c.json({ error: error instanceof Error ? error.message : "Could not create work" }, 500);
  }
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO work_galleries (work_id, gallery_id, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, galleryId, user.id, timestamp, timestamp).run();
  const work = (await getWork(c.env.DB, id))!;
  try {
    await createWorkVersion(c, work, body);
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM works WHERE id = ?").bind(id).run();
    return c.json({ error: error instanceof Error ? error.message : "Could not create work version" }, 400);
  }
  await insertEvent(c.env, "work.created", user.id, "work", id, "gallery", galleryId);
  const collaboratorResults = [];
  for (let index = 0; index < collaboratorInputs.length; index += 1) {
    collaboratorResults.push(await createWorkCollaborator(c, id, { ...collaboratorInputs[index], credit_order: index }));
  }
  return c.json({ work: await serializeWork(c.env, user, (await getWork(c.env.DB, id))!), collaborator_results: collaboratorResults }, 201);
});

app.get("/api/works/:id", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "view");
  if (!gate.ok) return gate.response;
  const versions = await c.env.DB.prepare("SELECT * FROM work_versions WHERE work_id = ? ORDER BY version_number DESC").bind(gate.work!.id).all<WorkVersionRow>();
  const collaborators = await c.env.DB.prepare(
    `SELECT work_collaborators.*, users.handle AS linked_handle
     FROM work_collaborators
     LEFT JOIN users ON users.id = work_collaborators.user_id
     WHERE work_collaborators.work_id = ?
     ORDER BY work_collaborators.credit_order, work_collaborators.display_name`,
  ).bind(gate.work!.id).all();
  return c.json({
    work: await serializeWork(c.env, currentUser(c), gate.work!),
    versions: await Promise.all(versions.results.map((version) => serializeVersion(c.env, version))),
    collaborators: collaborators.results,
  });
});

app.get("/api/works/:id/comments", async (c) => {
  const workId = c.req.param("id");
  const gate = await assertWorkCapability(c, workId, "view");
  if (!gate.ok) return gate.response;
  const rows = await c.env.DB.prepare(
    `SELECT comments.*, users.display_name, users.handle,
            parent_comments.body AS parent_body,
            parent_users.display_name AS parent_display_name,
            parent_users.handle AS parent_handle,
            work_versions.id AS version_id,
            work_versions.version_number AS version_number,
            work_versions.original_filename AS version_filename
     FROM comments
     JOIN users ON users.id = comments.author_id
     LEFT JOIN comments AS parent_comments ON parent_comments.id = comments.parent_comment_id AND parent_comments.deleted_at IS NULL
     LEFT JOIN users AS parent_users ON parent_users.id = parent_comments.author_id
     LEFT JOIN work_versions ON comments.target_type = 'version' AND comments.target_id = work_versions.id
     WHERE comments.deleted_at IS NULL
       AND (
         (comments.target_type = 'work' AND comments.target_id = ?)
         OR (comments.target_type = 'version' AND work_versions.work_id = ?)
       )
     ORDER BY comments.created_at ASC`,
  ).bind(workId, workId).all();
  const comments = [];
  for (const comment of rows.results as Array<{ id: string }>) {
    comments.push({ ...comment, reactions: await reactionSummary(c.env.DB, currentUser(c), "comment", comment.id) });
  }
  return c.json({ comments });
});

app.patch("/api/works/:id", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  const work = gate.work!;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE works
       SET title = ?, description = ?, content_warning = ?, feedback_prompt = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      stringField(body.title || work.title),
      stringField(body.description ?? work.description),
      stringField(body.content_warning || body.contentWarning || work.content_warning || "", "") || null,
      stringField(body.feedback_prompt || body.feedbackPrompt || work.feedback_prompt || "", "") || null,
      timestamp,
      work.id,
    ),
    c.env.DB.prepare("UPDATE work_galleries SET updated_at = ? WHERE work_id = ?").bind(timestamp, work.id),
    c.env.DB.prepare("UPDATE galleries SET updated_at = ? WHERE id IN (SELECT gallery_id FROM work_galleries WHERE work_id = ?)").bind(timestamp, work.id),
  ]);
  await insertEvent(c.env, "work.updated", currentUser(c).id, "work", work.id);
  return c.json({ work: await serializeWork(c.env, currentUser(c), (await getWork(c.env.DB, work.id))!) });
});

app.post("/api/works/:id/galleries", async (c) => {
  const workGate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!workGate.ok) return workGate.response;
  const body = await readBody(c);
  const galleryId = stringField(body.gallery_id || body.galleryId);
  if (!galleryId) return c.json({ error: "Gallery is required" }, 400);
  const galleryGate = await assertGalleryCapability(c, galleryId, "upload_work");
  if (!galleryGate.ok) return galleryGate.response;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO work_galleries (work_id, gallery_id, added_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(work_id, gallery_id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).bind(workGate.work!.id, galleryId, currentUser(c).id, timestamp, timestamp),
    c.env.DB.prepare("UPDATE works SET updated_at = ? WHERE id = ?").bind(timestamp, workGate.work!.id),
    c.env.DB.prepare("UPDATE galleries SET updated_at = ? WHERE id = ?").bind(timestamp, galleryId),
  ]);
  await insertEvent(c.env, "work.updated", currentUser(c).id, "work", workGate.work!.id, "gallery", galleryId, { crossposted_to_gallery_id: galleryId });
  return c.json({ work: await serializeWork(c.env, currentUser(c), (await getWork(c.env.DB, workGate.work!.id))!) });
});

app.delete("/api/works/:id/galleries/:galleryId", async (c) => {
  const workGate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!workGate.ok) return workGate.response;
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM work_galleries WHERE work_id = ?").bind(workGate.work!.id).first<{ count: number }>();
  if ((count?.count || 0) <= 1) return c.json({ error: "A work must remain in at least one gallery" }, 400);
  await c.env.DB.prepare("DELETE FROM work_galleries WHERE work_id = ? AND gallery_id = ?").bind(workGate.work!.id, c.req.param("galleryId")).run();
  await insertEvent(c.env, "work.updated", currentUser(c).id, "work", workGate.work!.id);
  return c.json({ work: await serializeWork(c.env, currentUser(c), (await getWork(c.env.DB, workGate.work!.id))!) });
});

app.delete("/api/works/:id", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!gate.ok) return gate.response;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, c.req.param("id")),
    c.env.DB.prepare("UPDATE galleries SET updated_at = ? WHERE id IN (SELECT gallery_id FROM work_galleries WHERE work_id = ?)").bind(timestamp, c.req.param("id")),
    c.env.DB.prepare("DELETE FROM work_galleries WHERE work_id = ?").bind(c.req.param("id")),
  ]);
  await insertEvent(c.env, "work.updated", currentUser(c).id, "work", c.req.param("id"), null, null, { deleted: true });
  return c.json({ ok: true });
});

app.post("/api/works/:id/versions", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "version");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  try {
    const version = await createWorkVersion(c, gate.work!, body);
    return c.json({ version: await serializeVersion(c.env, version) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not create version" }, 400);
  }
});

app.post("/api/works/:id/feedback-requested", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  const requested = body.feedback_requested == null ? true : truthy(body.feedback_requested);
  await c.env.DB.prepare("UPDATE works SET feedback_requested = ?, feedback_prompt = COALESCE(?, feedback_prompt), updated_at = ? WHERE id = ?")
    .bind(requested ? 1 : 0, stringField(body.feedback_prompt || body.feedbackPrompt, "") || null, now(), c.req.param("id")).run();
  if (requested) await insertEvent(c.env, "work.feedback_requested", currentUser(c).id, "work", c.req.param("id"));
  return c.json({ ok: true, feedback_requested: requested });
});

app.post("/api/works/:id/feedback-requested/dismiss", async (c) => {
  const user = currentUser(c);
  const gate = await assertWorkCapability(c, c.req.param("id"), "view");
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare(
    `INSERT INTO feedback_request_dismissals (work_id, user_id, dismissed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(work_id, user_id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
  ).bind(c.req.param("id"), user.id, now()).run();
  return c.json({ ok: true, dismissed: true });
});

app.delete("/api/works/:id/feedback-requested/dismiss", async (c) => {
  const user = currentUser(c);
  const gate = await assertWorkCapability(c, c.req.param("id"), "view");
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare("DELETE FROM feedback_request_dismissals WHERE work_id = ? AND user_id = ?").bind(c.req.param("id"), user.id).run();
  return c.json({ ok: true, dismissed: false });
});

app.post("/api/works/:id/collaborators", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  const result = await createWorkCollaborator(c, c.req.param("id"), body);
  if (!result.ok) return c.json({ error: result.error || "Could not add collaborator" }, 400);
  return c.json(result, result.duplicate ? 200 : 201);
});

app.patch("/api/works/:id/collaborators/:collaboratorId", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!gate.ok) return gate.response;
  const body = await readBody(c);
  const roleLabel = normalizeRoleLabel(stringField(body.role_label || body.roleLabel, ""));
  const roleSuggestionId = roleLabel ? await ensureWorkRoleSuggestion(c.env.DB, roleLabel, currentUser(c).id) : null;
  await c.env.DB.prepare(
    `UPDATE work_collaborators
     SET display_name = COALESCE(?, display_name),
         user_id = COALESCE(?, user_id),
         role_suggestion_id = COALESCE(?, role_suggestion_id),
         role_label = COALESCE(?, role_label),
         credit_order = COALESCE(?, credit_order),
         notes = COALESCE(?, notes),
         updated_at = ?
     WHERE id = ? AND work_id = ?`,
  ).bind(
    stringField(body.display_name || body.displayName, "") || null,
    stringField(body.user_id || body.userId, "") || null,
    roleSuggestionId,
    roleLabel || null,
    body.credit_order == null && body.creditOrder == null ? null : Math.floor(numberField(body.credit_order || body.creditOrder, 0)),
    body.notes == null ? null : stringField(body.notes),
    now(),
    c.req.param("collaboratorId"),
    c.req.param("id"),
  ).run();
  const collab = await c.env.DB.prepare("SELECT user_id FROM work_collaborators WHERE id = ?").bind(c.req.param("collaboratorId")).first<{ user_id: string | null }>();
  await insertEvent(c.env, "work.collaborator_updated", currentUser(c).id, "work", c.req.param("id"), "work_collaborator", c.req.param("collaboratorId"), { user_id: collab?.user_id || null });
  return c.json({ ok: true });
});

app.delete("/api/works/:id/collaborators/:collaboratorId", async (c) => {
  const gate = await assertWorkCapability(c, c.req.param("id"), "edit");
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare("DELETE FROM work_collaborators WHERE id = ? AND work_id = ?").bind(c.req.param("collaboratorId"), c.req.param("id")).run();
  return c.json({ ok: true });
});

app.post("/api/comments", async (c) => {
  const user = currentUser(c);
  const body = await readBody(c);
  const targetType = stringField(body.target_type || body.targetType);
  const targetId = stringField(body.target_id || body.targetId);
  if (!(await canCommentTarget(c.env.DB, user, targetType, targetId))) return c.json({ error: "Forbidden" }, 403);
  const id = ulid();
  const parentId = stringField(body.parent_comment_id || body.parentCommentId, "") || null;
  const commentBody = stringField(body.body);
  await c.env.DB.prepare(
    `INSERT INTO comments (id, target_type, target_id, parent_comment_id, author_id, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, targetType, targetId, parentId, user.id, commentBody, now(), now()).run();
  const eventType = parentId ? "comment.replied" : "comment.created";
  await insertEvent(c.env, eventType, user.id, "comment", id, targetType, targetId, { parent_comment_id: parentId, body: commentBody });
  return c.json({ id }, 201);
});

app.get("/api/comments", async (c) => {
  const targetType = stringField(c.req.query("target_type") || c.req.query("targetType"));
  const targetId = stringField(c.req.query("target_id") || c.req.query("targetId"));
  if (!(await canViewTarget(c.env.DB, currentUser(c), targetType, targetId))) return c.json({ error: "Forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT comments.*, users.display_name, users.handle,
            parent_comments.body AS parent_body,
            parent_users.display_name AS parent_display_name,
            parent_users.handle AS parent_handle
     FROM comments
     JOIN users ON users.id = comments.author_id
     LEFT JOIN comments AS parent_comments ON parent_comments.id = comments.parent_comment_id AND parent_comments.deleted_at IS NULL
     LEFT JOIN users AS parent_users ON parent_users.id = parent_comments.author_id
     WHERE target_type = ? AND target_id = ? AND comments.deleted_at IS NULL
     ORDER BY comments.created_at ASC`,
  ).bind(targetType, targetId).all();
  const comments = [];
  for (const comment of rows.results as Array<{ id: string }>) {
    comments.push({ ...comment, reactions: await reactionSummary(c.env.DB, currentUser(c), "comment", comment.id) });
  }
  return c.json({ comments });
});

app.post("/api/reactions/:targetType/:targetId/heart", async (c) => {
  const user = currentUser(c);
  const targetType = stringField(c.req.param("targetType"));
  const targetId = stringField(c.req.param("targetId"));
  if (targetType !== "work" && targetType !== "comment") return c.json({ error: "Unsupported reaction target" }, 400);
  if (!(await canViewTarget(c.env.DB, user, targetType, targetId))) return c.json({ error: "Forbidden" }, 403);
  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO reactions (id, target_type, target_id, user_id, reaction, created_at)
     VALUES (?, ?, ?, ?, 'heart', ?)`,
  ).bind(ulid(), targetType, targetId, user.id, now()).run();
  if ((result.meta?.changes || 0) > 0) {
    await insertEvent(c.env, "reaction.created", user.id, "reaction", targetId, targetType, targetId, { target_type: targetType, target_id: targetId, reaction: "heart" });
  }
  return c.json({ reactions: await reactionSummary(c.env.DB, user, targetType, targetId) });
});

app.delete("/api/reactions/:targetType/:targetId/heart", async (c) => {
  const user = currentUser(c);
  const targetType = stringField(c.req.param("targetType"));
  const targetId = stringField(c.req.param("targetId"));
  if (targetType !== "work" && targetType !== "comment") return c.json({ error: "Unsupported reaction target" }, 400);
  if (!(await canViewTarget(c.env.DB, user, targetType, targetId))) return c.json({ error: "Forbidden" }, 403);
  await c.env.DB.prepare(
    "DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND reaction = 'heart'",
  ).bind(targetType, targetId, user.id).run();
  return c.json({ reactions: await reactionSummary(c.env.DB, user, targetType, targetId) });
});

app.get("/api/tags/:tag", async (c) => {
  const user = currentUser(c);
  const tag = normalizeTag(c.req.param("tag"));
  if (!tag) return c.json({ error: "Tag is required" }, 400);
  const pattern = `%#${tag}%`;
  const barePattern = `%${tag}%`;

  const galleryRows = await c.env.DB.prepare(
    `SELECT * FROM galleries
     WHERE lower(title) LIKE ? OR lower(description) LIKE ?
     ORDER BY updated_at DESC LIMIT 80`,
  ).bind(pattern, pattern).all<GalleryRow>();
  const galleries = [];
  for (const gallery of galleryRows.results) {
    if ((await galleryCapabilities(c.env.DB, user, gallery.id)).view) {
      galleries.push(await serializeGallery(c.env, user, gallery));
    }
  }

  const workRows = await c.env.DB.prepare(
    `SELECT * FROM works
     WHERE deleted_at IS NULL AND (lower(title) LIKE ? OR lower(description) LIKE ?)
     ORDER BY updated_at DESC LIMIT 120`,
  ).bind(pattern, pattern).all<WorkRow>();
  const works = [];
  for (const work of workRows.results) {
    const serialized = await serializeWork(c.env, user, work);
    if (serialized.capabilities.view) works.push(serialized);
  }

  const memberRows = await c.env.DB.prepare(
    `SELECT DISTINCT users.*
     FROM users
     LEFT JOIN medium_tags ON medium_tags.user_id = users.id
     WHERE users.disabled_at IS NULL
       AND (lower(users.handle) LIKE ? OR lower(users.bio) LIKE ? OR lower(medium_tags.tag) = ?)
     ORDER BY users.handle COLLATE NOCASE LIMIT 80`,
  ).bind(barePattern, pattern, tag).all<AppUser>();
  const members = [];
  for (const member of memberRows.results) {
    members.push(publicUser(member, await getTags(c.env.DB, member.id)));
  }

  const commentRows = await c.env.DB.prepare(
    `SELECT comments.*, users.display_name, users.handle,
            parent_comments.body AS parent_body,
            parent_users.display_name AS parent_display_name,
            parent_users.handle AS parent_handle
     FROM comments
     JOIN users ON users.id = comments.author_id
     LEFT JOIN comments AS parent_comments ON parent_comments.id = comments.parent_comment_id AND parent_comments.deleted_at IS NULL
     LEFT JOIN users AS parent_users ON parent_users.id = parent_comments.author_id
     WHERE comments.deleted_at IS NULL AND lower(comments.body) LIKE ?
     ORDER BY comments.created_at DESC LIMIT 120`,
  ).bind(pattern).all<{ target_type: string; target_id: string }>();
  const comments = [];
  for (const comment of commentRows.results as Array<{ id: string; target_type: string; target_id: string }>) {
    if (await canViewTarget(c.env.DB, user, comment.target_type, comment.target_id)) {
      comments.push({ ...comment, reactions: await reactionSummary(c.env.DB, user, "comment", comment.id) });
    }
  }

  return c.json({ tag, galleries, works, members, comments });
});

app.patch("/api/comments/:id", async (c) => {
  const user = currentUser(c);
  const comment = await c.env.DB.prepare("SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).first<{ author_id: string; target_type: string; target_id: string }>();
  if (!comment) return c.json({ error: "Not found" }, 404);
  if (comment.author_id !== user.id && user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  const body = await readBody(c);
  await c.env.DB.prepare("UPDATE comments SET body = ?, updated_at = ? WHERE id = ?").bind(stringField(body.body), now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

app.delete("/api/comments/:id", async (c) => {
  const user = currentUser(c);
  const comment = await c.env.DB.prepare("SELECT author_id FROM comments WHERE id = ? AND deleted_at IS NULL").bind(c.req.param("id")).first<{ author_id: string }>();
  if (!comment) return c.json({ error: "Not found" }, 404);
  if (comment.author_id !== user.id && user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  await c.env.DB.prepare("UPDATE comments SET deleted_at = ?, updated_at = ? WHERE id = ?").bind(now(), now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

type ActivityRow = {
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

async function eventVisibleTo(db: D1Database, user: AppUser, event: ActivityRow) {
  if (event.subject_type === "gallery") return canViewTarget(db, user, "gallery", event.subject_id);
  if (event.subject_type === "work") return canViewTarget(db, user, "work", event.subject_id);
  if (event.target_type && event.target_id) return canViewTarget(db, user, event.target_type, event.target_id);
  return user.role === "admin" || event.subject_type === "user" || event.subject_type === "profile";
}

async function workThumbnail(env: Env, workId: string, versionId = "") {
  const version = versionId
    ? await env.DB.prepare("SELECT * FROM work_versions WHERE id = ? AND work_id = ?").bind(versionId, workId).first<WorkVersionRow>()
    : await env.DB.prepare(
      `SELECT work_versions.*
       FROM work_versions JOIN works ON works.current_version_id = work_versions.id
       WHERE works.id = ?`,
    ).bind(workId).first<WorkVersionRow>();
  if (!version?.thumbnail_r2_key) return null;
  return (await signedMediaUrl(env, version.thumbnail_r2_key, version.thumbnail_content_type, "thumbnail")) || `/api/media/works/${workId}/versions/${version.id}/thumbnail`;
}

async function activityEntry(env: Env, user: AppUser, event: ActivityRow) {
  const payload = parseJson<Record<string, unknown>>(event.payload_json, {});
  const actor = event.actor_id
    ? await env.DB.prepare("SELECT handle FROM users WHERE id = ?").bind(event.actor_id).first<{ handle: string }>()
    : null;
  const actorLabel = actor?.handle ? `@${actor.handle}` : "Someone";
  let summary = `${actorLabel} ${event.type.replace(/\./g, " ")}`;
  let href: string | null = null;
  let thumbnail_url: string | null = null;
  let comment_preview: string | null = null;

  if (event.type === "gallery.created" || event.type === "gallery.updated" || event.type === "gallery.visibility_changed") {
    const gallery = await env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(event.subject_id).first<GalleryRow>();
    if (gallery) {
      href = `/galleries/${gallery.id}`;
      const title = typeof payload.title === "string" && payload.title ? payload.title : gallery.title;
      if (event.type === "gallery.created") summary = `${actorLabel} created gallery "${gallery.title}"`;
      if (event.type === "gallery.updated") {
        summary = payload.previous_title && payload.previous_title !== title
          ? `${actorLabel} updated the gallery name to "${title}"`
          : `${actorLabel} updated gallery "${gallery.title}"`;
      }
      if (event.type === "gallery.visibility_changed") summary = `${actorLabel} changed visibility on "${gallery.title}"`;
      if (gallery.cover_version_id && gallery.cover_work_id) thumbnail_url = await workThumbnail(env, gallery.cover_work_id, gallery.cover_version_id);
    }
  } else if (event.type === "work.created" || event.type === "work.updated" || event.type === "work.version_created" || event.type === "work.feedback_requested") {
    const work = await getWork(env.DB, event.subject_id);
    if (work) {
      href = `/works/${work.id}`;
      thumbnail_url = await workThumbnail(env, work.id, typeof payload.version_id === "string" ? payload.version_id : "");
      if (event.type === "work.created") summary = `${actorLabel} added "${work.title}"`;
      if (event.type === "work.updated") summary = `${actorLabel} updated work "${work.title}"`;
      if (event.type === "work.version_created") summary = `${actorLabel} updated work "${work.title}"`;
      if (event.type === "work.feedback_requested") summary = `${actorLabel} requested feedback on "${work.title}"`;
    }
  } else if (event.type === "comment.created" || event.type === "comment.replied") {
    const body = typeof payload.body === "string" ? payload.body : "";
    comment_preview = stripMarkdownImages(body).slice(0, 360);
    const mentionedYou = extractMentions(body).includes(user.handle.toLowerCase());
    if (event.target_type === "work" && event.target_id) {
      const work = await getWork(env.DB, event.target_id);
      if (work) {
        href = `/works/${work.id}`;
        thumbnail_url = await workThumbnail(env, work.id);
        summary = mentionedYou ? `${actorLabel} mentioned you on "${work.title}"` : `${actorLabel} commented on "${work.title}"`;
      }
    } else if (event.target_type === "gallery" && event.target_id) {
      const gallery = await env.DB.prepare("SELECT title FROM galleries WHERE id = ?").bind(event.target_id).first<{ title: string }>();
      if (gallery) {
        href = `/galleries/${event.target_id}`;
        summary = mentionedYou ? `${actorLabel} mentioned you in gallery "${gallery.title}"` : `${actorLabel} commented in "${gallery.title}"`;
      }
    } else if (event.target_type === "version" && event.target_id) {
      const version = await env.DB.prepare(
        `SELECT work_versions.id, work_versions.work_id, works.title
         FROM work_versions JOIN works ON works.id = work_versions.work_id
         WHERE work_versions.id = ?`,
      ).bind(event.target_id).first<{ id: string; work_id: string; title: string }>();
      if (version) {
        href = `/works/${version.work_id}`;
        thumbnail_url = await workThumbnail(env, version.work_id, version.id);
        summary = mentionedYou ? `${actorLabel} mentioned you on a version of "${version.title}"` : `${actorLabel} commented on a version of "${version.title}"`;
      }
    } else if (mentionedYou) {
      summary = `${actorLabel} mentioned you`;
    }
    if (event.type === "comment.replied" && !mentionedYou) summary = `${actorLabel} replied to a comment`;
  } else if (event.type === "reaction.created") {
    const targetType = String(payload.target_type || event.target_type || "");
    const targetId = String(payload.target_id || event.target_id || "");
    if (targetType === "work") {
      const work = await getWork(env.DB, targetId);
      if (work) {
        href = `/works/${work.id}`;
        thumbnail_url = await workThumbnail(env, work.id);
        summary = `${actorLabel} liked "${work.title}"`;
      }
    } else if (targetType === "comment") {
      const comment = await env.DB.prepare("SELECT target_type, target_id, body FROM comments WHERE id = ? AND deleted_at IS NULL").bind(targetId).first<{ target_type: string; target_id: string; body: string }>();
      if (comment) {
        comment_preview = stripMarkdownImages(comment.body).slice(0, 240);
        summary = `${actorLabel} liked a comment`;
        if (comment.target_type === "work") href = `/works/${comment.target_id}`;
        if (comment.target_type === "gallery") href = `/galleries/${comment.target_id}`;
        if (comment.target_type === "profile") {
          const profile = await env.DB.prepare("SELECT handle FROM users WHERE id = ?").bind(comment.target_id).first<{ handle: string }>();
          if (profile) href = `/members/${profile.handle}`;
        }
        if (comment.target_type === "version") {
          const version = await env.DB.prepare("SELECT work_id FROM work_versions WHERE id = ?").bind(comment.target_id).first<{ work_id: string }>();
          if (version) href = `/works/${version.work_id}`;
        }
      }
    }
  } else if (event.type === "profile.updated") {
    summary = `${actorLabel} updated their profile`;
    href = actor?.handle ? `/members/${actor.handle}` : null;
  } else if (event.type === "invite.accepted") {
    summary = `${actorLabel} accepted an invite`;
  } else if (event.type === "user.joined") {
    summary = `${actorLabel} joined`;
    href = actor?.handle ? `/members/${actor.handle}` : null;
  }

  return {
    ...event,
    actor_handle: actor?.handle || null,
    summary,
    href,
    thumbnail_url,
    comment_preview,
  };
}

type ActivityJoinedRow = ActivityRow & {
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

function addId(ids: Set<string>, value: string | null | undefined) {
  if (value) ids.add(value);
}

function placeholders(ids: string[]) {
  return ids.map(() => "?").join(",");
}

async function visibleGalleryIds(db: D1Database, user: AppUser, ids: Set<string>) {
  const values = [...ids];
  if (!values.length) return new Set<string>();
  const marker = placeholders(values);
  if (user.role === "admin") {
    const rows = await db.prepare(`SELECT id FROM galleries WHERE id IN (${marker})`).bind(...values).all<{ id: string }>();
    return new Set(rows.results.map((row) => row.id));
  }
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

async function visibleWorkIds(db: D1Database, user: AppUser, ids: Set<string>) {
  const values = [...ids];
  if (!values.length) return new Set<string>();
  const marker = placeholders(values);
  if (user.role === "admin") {
    const rows = await db.prepare(`SELECT id FROM works WHERE deleted_at IS NULL AND id IN (${marker})`).bind(...values).all<{ id: string }>();
    return new Set(rows.results.map((row) => row.id));
  }
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

function collectActivityVisibilityIds(rows: ActivityJoinedRow[]) {
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

function joinedEventVisible(user: AppUser, row: ActivityJoinedRow, visibleGalleries: Set<string>, visibleWorks: Set<string>) {
  if (row.subject_type === "user" || row.subject_type === "profile") return true;
  if (row.subject_type === "gallery") return visibleGalleries.has(row.subject_id);
  if (row.subject_type === "work") return !!row.subject_work_id && visibleWorks.has(row.subject_work_id);
  if (row.target_type && row.target_id) return targetVisible(row, visibleGalleries, visibleWorks);
  return user.role === "admin";
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

async function activityEntryFromJoinedRow(
  env: Env,
  user: AppUser,
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
  } else if (row.type === "work.created" || row.type === "work.updated" || row.type === "work.version_created" || row.type === "work.feedback_requested") {
    const workTitle = row.subject_work_title || "work";
    href = row.subject_work_id ? `/works/${row.subject_work_id}` : null;
    if (row.target_version_id) {
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_version_thumb_key, row.target_version_thumb_type, row.target_version_work_id, row.target_version_id);
    } else {
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.subject_work_thumb_key, row.subject_work_thumb_type, row.subject_work_id, row.subject_work_thumb_version_id);
    }
    if (row.type === "work.created") summary = `${actorLabel} added "${workTitle}"`;
    if (row.type === "work.updated") summary = `${actorLabel} updated work "${workTitle}"`;
    if (row.type === "work.version_created") summary = `${actorLabel} updated work "${workTitle}"`;
    if (row.type === "work.feedback_requested") summary = `${actorLabel} requested feedback on "${workTitle}"`;
  } else if (row.type === "comment.created" || row.type === "comment.replied") {
    const body = typeof payload.body === "string" ? payload.body : "";
    comment_preview = stripMarkdownImages(body).slice(0, 360);
    const mentionedYou = extractMentions(body).includes(user.handle.toLowerCase());
    if (row.target_type === "work" && row.target_work_id) {
      href = `/works/${row.target_work_id}`;
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_work_thumb_key, row.target_work_thumb_type, row.target_work_id, row.target_work_thumb_version_id);
      summary = mentionedYou ? `${actorLabel} mentioned you on "${row.target_work_title || "work"}"` : `${actorLabel} commented on "${row.target_work_title || "work"}"`;
    } else if (row.target_type === "gallery" && row.target_id) {
      href = `/galleries/${row.target_id}`;
      summary = mentionedYou ? `${actorLabel} mentioned you in gallery "${row.target_gallery_title || "gallery"}"` : `${actorLabel} commented in "${row.target_gallery_title || "gallery"}"`;
    } else if (row.target_type === "version" && row.target_version_work_id) {
      href = `/works/${row.target_version_work_id}`;
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_version_thumb_key, row.target_version_thumb_type, row.target_version_work_id, row.target_version_id);
      summary = mentionedYou ? `${actorLabel} mentioned you on a version of "${row.target_version_work_title || "work"}"` : `${actorLabel} commented on a version of "${row.target_version_work_title || "work"}"`;
    } else if (mentionedYou) {
      summary = `${actorLabel} mentioned you`;
    }
    if (row.type === "comment.replied" && !mentionedYou) summary = `${actorLabel} replied to a comment`;
  } else if (row.type === "reaction.created") {
    const targetType = String(payload.target_type || row.target_type || "");
    if (targetType === "work" && row.target_work_id) {
      href = `/works/${row.target_work_id}`;
      thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.target_work_thumb_key, row.target_work_thumb_type, row.target_work_id, row.target_work_thumb_version_id);
      summary = `${actorLabel} liked "${row.target_work_title || "work"}"`;
    } else if (targetType === "comment") {
      comment_preview = stripMarkdownImages(row.target_comment_body || "").slice(0, 240);
      summary = `${actorLabel} liked a comment`;
      if (row.target_comment_target_type === "work" && row.comment_target_work_id) {
        href = `/works/${row.comment_target_work_id}`;
        thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.comment_target_work_thumb_key, row.comment_target_work_thumb_type, row.comment_target_work_id, row.comment_target_work_thumb_version_id);
      }
      if (row.target_comment_target_type === "gallery" && row.target_comment_target_id) href = `/galleries/${row.target_comment_target_id}`;
      if (row.target_comment_target_type === "profile" && row.comment_target_profile_handle) href = `/members/${row.comment_target_profile_handle}`;
      if (row.target_comment_target_type === "version" && row.comment_target_version_work_id) {
        href = `/works/${row.comment_target_version_work_id}`;
        thumbnail_url = await activityThumbnailUrl(env, thumbnailCache, row.comment_target_version_thumb_key, row.comment_target_version_thumb_type, row.comment_target_version_work_id, row.comment_target_version_id);
      }
    }
  } else if (row.type === "profile.updated") {
    summary = `${actorLabel} updated their profile`;
    href = row.actor_handle ? `/members/${row.actor_handle}` : null;
  } else if (row.type === "invite.accepted") {
    summary = `${actorLabel} accepted an invite`;
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

app.get("/api/activity", async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `WITH recent AS (
       SELECT * FROM domain_events ORDER BY created_at DESC LIMIT 120
     )
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
       AND comment_target_profile.disabled_at IS NULL
     ORDER BY recent.created_at DESC`,
  ).all<ActivityJoinedRow>();
  const { galleryIds, workIds } = collectActivityVisibilityIds(rows.results);
  const [galleries, works] = await Promise.all([
    visibleGalleryIds(c.env.DB, user, galleryIds),
    visibleWorkIds(c.env.DB, user, workIds),
  ]);
  const thumbnailCache = new Map<string, Promise<string | null>>();
  const visibleRows = rows.results.filter((event) => joinedEventVisible(user, event, galleries, works)).slice(0, 60);
  const events = await Promise.all(visibleRows.map((event) => activityEntryFromJoinedRow(c.env, user, event, thumbnailCache)));
  return c.json({ events });
});

app.get("/api/notifications", async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT notifications.*, domain_events.type AS event_type, domain_events.actor_id,
            domain_events.subject_type, domain_events.subject_id, domain_events.target_type,
            domain_events.target_id, domain_events.payload_json
     FROM notifications
     LEFT JOIN domain_events ON domain_events.id = notifications.event_id
     WHERE notifications.user_id = ?
     ORDER BY notifications.created_at DESC LIMIT 100`,
  ).bind(user.id).all<{
    id: string;
    event_id: string;
    type: string;
    body: string;
    read_at: string | null;
    created_at: string;
    event_type: string | null;
    actor_id: string | null;
    subject_type: string | null;
    subject_id: string | null;
    target_type: string | null;
    target_id: string | null;
    payload_json: string | null;
  }>();
  const notifications = [];
  for (const row of rows.results) {
    let activity = null;
    try {
      if (row.event_type && row.subject_type && row.subject_id) {
        activity = await activityEntry(c.env, user, {
          id: row.event_id,
          type: row.event_type,
          actor_id: row.actor_id,
          subject_type: row.subject_type,
          subject_id: row.subject_id,
          target_type: row.target_type,
          target_id: row.target_id,
          payload_json: row.payload_json,
          created_at: row.created_at,
        });
      }
    } catch {
      activity = null;
    }
    notifications.push({
      ...row,
      summary: activity?.summary || row.body,
      href: activity?.href || null,
      thumbnail_url: activity?.thumbnail_url || null,
      comment_preview: activity?.comment_preview || null,
    });
  }
  return c.json({ notifications });
});

app.post("/api/notifications/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?").bind(now(), c.req.param("id"), currentUser(c).id).run();
  return c.json({ ok: true });
});

app.post("/api/notifications/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND read_at IS NULL").bind(now(), currentUser(c).id).run();
  return c.json({ ok: true });
});

async function buildExport(env: Env, user: AppUser, exportId: string) {
  const tags = await getTags(env.DB, user.id);
  const galleries = await env.DB.prepare("SELECT * FROM galleries WHERE owner_user_id = ? OR created_by = ?").bind(user.id, user.id).all();
  const works = await env.DB.prepare("SELECT * FROM works WHERE created_by = ? AND deleted_at IS NULL").bind(user.id).all<WorkRow>();
  const writing = await env.DB.prepare(
    `SELECT work_versions.*
     FROM work_versions JOIN works ON works.id = work_versions.work_id
     WHERE works.created_by = ? AND works.type = 'writing'
     ORDER BY work_versions.created_at`,
  ).bind(user.id).all();
  const collaborators = await env.DB.prepare("SELECT * FROM work_collaborators WHERE created_by = ? OR user_id = ?").bind(user.id, user.id).all();
  const comments = await env.DB.prepare("SELECT * FROM comments WHERE author_id = ? ORDER BY created_at").bind(user.id).all();
  const events = await env.DB.prepare(
    `SELECT * FROM domain_events
     WHERE actor_id = ?
        OR (subject_type = 'user' AND subject_id = ?)
        OR (target_type = 'user' AND target_id = ?)
     ORDER BY created_at`,
  ).bind(user.id, user.id, user.id).all();
  const notifications = await env.DB.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at").bind(user.id).all();

  const assets: Array<{ kind: string; name: string; url: string }> = [];
  if (user.profile_image_key) assets.push({ kind: "profile_image", name: "profile-image", url: `/api/media/users/${user.id}/profile` });
  if (user.avatar_key) assets.push({ kind: "avatar", name: "avatar", url: `/api/media/users/${user.id}/avatar` });
  for (const work of works.results) {
    if (work.type !== "image") continue;
    const versions = await env.DB.prepare("SELECT id, original_filename FROM work_versions WHERE work_id = ? AND original_r2_key IS NOT NULL").bind(work.id).all<{ id: string; original_filename: string | null }>();
    for (const version of versions.results) {
      assets.push({ kind: "original_image", name: version.original_filename || `${work.id}-${version.id}`, url: `/api/media/works/${work.id}/versions/${version.id}/original` });
    }
  }

  const manifest = {
    export_id: exportId,
    generated_at: now(),
    content_notice: "Uploaded user content remains owned by the uploader or rights holder.",
    profile: publicUser(user, tags),
    medium_tags: tags,
    owned_galleries: galleries.results,
    owned_works: works.results,
    writing_content: writing.results,
    collaborator_records: collaborators.results,
    comments: comments.results,
    events: events.results,
    notifications: notifications.results,
    assets,
  };
  const key = `exports/${user.id}/${exportId}/manifest.json`;
  await env.MEDIA.put(key, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { owner: user.id, kind: "export_manifest" },
  });
  await env.DB.prepare("UPDATE export_jobs SET status = 'ready', manifest_r2_key = ?, updated_at = ?, completed_at = ? WHERE id = ?").bind(key, now(), now(), exportId).run();
  await insertEvent(env, "export.ready", user.id, "export", exportId);
  return manifest;
}

app.post("/api/exports/me", async (c) => {
  const user = currentUser(c);
  const id = ulid();
  await c.env.DB.prepare("INSERT INTO export_jobs (id, user_id, status, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?)").bind(id, user.id, now(), now()).run();
  const manifest = await buildExport(c.env, user, id);
  return c.json({ export: { id, status: "ready", manifest_url: `/api/exports/${id}` }, manifest }, 201);
});

app.get("/api/exports/me", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM export_jobs WHERE user_id = ? ORDER BY created_at DESC").bind(currentUser(c).id).all();
  return c.json({ exports: rows.results });
});

app.get("/api/exports/:id", async (c) => {
  const job = await c.env.DB.prepare("SELECT * FROM export_jobs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), currentUser(c).id).first<{ manifest_r2_key: string | null; status: string }>();
  if (!job) return c.json({ error: "Not found" }, 404);
  if (job.status !== "ready" || !job.manifest_r2_key) return c.json({ status: job.status });
  const object = await c.env.MEDIA.get(job.manifest_r2_key);
  if (!object) return c.json({ error: "Manifest not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
});

app.get("/api/media/users/:id/:kind", async (c) => {
  const targetId = c.req.param("id");
  if (!(await canViewTarget(c.env.DB, currentUser(c), "profile", targetId))) return c.json({ error: "Forbidden" }, 403);
  const user = await getUserById(c.env.DB, targetId);
  if (!user) return c.json({ error: "Not found" }, 404);
  const kind = c.req.param("kind");
  const key = kind === "avatar" ? user.avatar_key : user.profile_image_key;
  const contentType = kind === "avatar" ? user.avatar_content_type : user.profile_image_content_type;
  if (!key) return c.json({ error: "Not found" }, 404);
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": contentType || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
});

app.get("/api/media/galleries/:id/cover", async (c) => {
  const id = c.req.param("id");
  const gate = await assertGalleryCapability(c, id, "view");
  if (!gate.ok) return gate.response;
  const gallery = await c.env.DB.prepare("SELECT cover_image_key, cover_image_content_type FROM galleries WHERE id = ?")
    .bind(id)
    .first<{ cover_image_key: string | null; cover_image_content_type: string | null }>();
  if (!gallery?.cover_image_key) return c.json({ error: "Not found" }, 404);
  const object = await c.env.MEDIA.get(gallery.cover_image_key);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": gallery.cover_image_content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
});

app.get("/api/media/markdown-assets/:id", async (c) => {
  const asset = await c.env.DB.prepare("SELECT * FROM markdown_assets WHERE id = ?").bind(c.req.param("id")).first<{
    owner_user_id: string;
    target_type: string;
    target_id: string | null;
    r2_key: string;
    content_type: string;
  }>();
  if (!asset) return c.json({ error: "Not found" }, 404);
  const user = currentUser(c);
  if (asset.owner_user_id !== user.id && asset.target_id && asset.target_type !== "draft" && !(await canViewTarget(c.env.DB, user, asset.target_type, asset.target_id))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const object = await c.env.MEDIA.get(asset.r2_key);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": asset.content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
});

app.get("/api/media/works/:workId/versions/:versionId/:variant", async (c) => {
  const workId = c.req.param("workId");
  const gate = await assertWorkCapability(c, workId, "view");
  if (!gate.ok) return gate.response;
  const version = await c.env.DB.prepare("SELECT * FROM work_versions WHERE id = ? AND work_id = ?").bind(c.req.param("versionId"), workId).first<WorkVersionRow>();
  if (!version) return c.json({ error: "Not found" }, 404);
  const variant = c.req.param("variant");
  const key = variant === "thumbnail" ? version.thumbnail_r2_key : variant === "preview" ? version.preview_r2_key : version.original_r2_key;
  const contentType = variant === "thumbnail" ? version.thumbnail_content_type : variant === "preview" ? version.preview_content_type : version.original_content_type;
  if (!key) return c.json({ error: "Not found" }, 404);
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": contentType || object.httpMetadata?.contentType || "application/octet-stream",
      "cache-control": cacheControl(variant),
      "content-disposition": variant === "original" && version.original_filename ? `attachment; filename="${version.original_filename.replace(/"/g, "")}"` : "inline",
    },
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ kind?: string; eventId?: string }>, env: Env) {
    for (const message of batch.messages) {
      if (message.body?.kind === "process_event" && message.body.eventId) {
        await processEvent(env, message.body.eventId);
      }
      message.ack();
    }
  },
};
