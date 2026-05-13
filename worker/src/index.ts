import { Hono, type Next } from "hono";
import { ulid } from "ulid";
import {
  bumpApiCacheToken,
  prepareApiCache as prepareApiCacheState,
} from "./api-cache";
import type { AppContext, Ctx } from "./app-context";
import { signedMediaUrl } from "./media";
import { canCrosspostToGallery, ownsGallery, resolveGalleryCapabilities, resolveWorkCapabilities, type GalleryMemberPermissions } from "./permissions";
import { registerRoutes } from "./routes";
import { createSession, expiredSessionCookie, parseCookies, readSession, sessionCookie, userFromSessionClaims } from "./sessions";
import type { AppUser, AuthenticatedUser, Env, GalleryCapabilities, GalleryRow, WorkRow, WorkVersionRow } from "./types";
import { sendWebPushTickle, webPushConfigured } from "./web-push";
import {
  extractMentions,
  jsonText,
  normalizeHandle,
  normalizeRoleLabel,
  now,
  parseJson,
  stringField,
} from "./utils";

const app = new Hono<AppContext>();

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

const PUBLIC_INSTANCE_SETTINGS_CACHE_KEY = "instance:public-settings:v1";
const PUBLIC_INSTANCE_SETTINGS_CACHE_VERSION = 3;
const PUBLIC_INSTANCE_SETTING_KEYS = [
  "instance_name",
  "site_url",
  "app_name",
  "app_short_name",
  "app_theme_color",
  "app_background_color",
  "source_code_url",
  "logo_r2_key",
  "logo_content_type",
  "app_icon_r2_key",
  "app_icon_content_type",
  "app_icon_updated_at",
  "app_icon_16_r2_key",
  "app_icon_16_content_type",
  "app_icon_16_updated_at",
  "app_icon_32_r2_key",
  "app_icon_32_content_type",
  "app_icon_32_updated_at",
  "app_icon_192_r2_key",
  "app_icon_192_content_type",
  "app_icon_192_updated_at",
  "app_maskable_icon_r2_key",
  "app_maskable_icon_content_type",
  "app_maskable_icon_updated_at",
  "app_maskable_icon_192_r2_key",
  "app_maskable_icon_192_content_type",
  "app_maskable_icon_192_updated_at",
  "content_notice",
  "homepage_subtitle",
  "login_subtitle",
  "invite_subtitle",
] as const;

type PublicInstanceSettings = {
  cache_version: number;
  name: string;
  site_url: string;
  app_name: string;
  app_short_name: string;
  app_theme_color: string;
  app_background_color: string;
  source_code_url: string;
  logo_url: string;
  app_icon_url: string;
  app_maskable_icon_url: string;
  content_notice: string;
  homepage_subtitle: string;
  login_subtitle: string;
  invite_subtitle: string;
  logo_r2_key: string | null;
  logo_content_type: string | null;
  app_icon_r2_key: string | null;
  app_icon_content_type: string | null;
  app_icon_updated_at: string;
  app_icon_16_r2_key: string | null;
  app_icon_16_content_type: string | null;
  app_icon_16_updated_at: string;
  app_icon_32_r2_key: string | null;
  app_icon_32_content_type: string | null;
  app_icon_32_updated_at: string;
  app_icon_192_r2_key: string | null;
  app_icon_192_content_type: string | null;
  app_icon_192_updated_at: string;
  app_maskable_icon_r2_key: string | null;
  app_maskable_icon_content_type: string | null;
  app_maskable_icon_updated_at: string;
  app_maskable_icon_192_r2_key: string | null;
  app_maskable_icon_192_content_type: string | null;
  app_maskable_icon_192_updated_at: string;
};

async function prepareApiCache(c: Ctx, scope: string) {
  return prepareApiCacheState(c.env.DB, currentUser(c).id, c.req.header("if-none-match"), scope);
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

async function getUserById(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<AppUser>();
}

type SessionUserRow = AuthenticatedUser & { last_active_at: string | null };

async function getSessionUserById(db: D1Database, id: string) {
  return db.prepare(
    `SELECT id, role, disabled_at, password_changed_at, force_password_change_at, last_active_at
     FROM users
     WHERE id = ?`,
  ).bind(id).first<SessionUserRow>();
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

function requestCountsAsActivity(c: Ctx) {
  return c.req.path !== "/api/notifications/poll";
}

async function requireUser(c: Ctx, next: Next) {
  const auth = c.req.header("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer || parseCookies(c.req.header("cookie")).get("qc_session");
  if (!token) return c.json({ error: "Not authenticated" }, 401);

  const session = await readSession(token, c.env).catch(() => null);
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  let user: AuthenticatedUser;
  if (session.kind === "legacy" || session.stale) {
    const userId = session.kind === "legacy" ? session.userId : session.claims.uid;
    const row = await getSessionUserById(c.env.DB, userId);
    if (!row || row.disabled_at) {
      c.header("Set-Cookie", expiredSessionCookie());
      return c.json({ error: "Not authenticated" }, 401);
    }

    user = {
      id: row.id,
      role: row.role,
      disabled_at: null,
      password_changed_at: row.password_changed_at,
      force_password_change_at: row.force_password_change_at,
    };

    const refreshedToken = await createSession(user, c.env, { expiresAt: session.expiresAt });
    c.header("Set-Cookie", sessionCookie(refreshedToken, session.expiresAt));

    const lastActive = row.last_active_at ? Date.parse(row.last_active_at) : 0;
    if (requestCountsAsActivity(c) && (!lastActive || Date.now() - lastActive > 60 * 60 * 1000)) {
      const timestamp = now();
      await c.env.DB.prepare("UPDATE users SET last_active_at = ? WHERE id = ?").bind(timestamp, user.id).run().catch(() => undefined);
    }
  } else {
    user = userFromSessionClaims(session.claims);
  }

  c.set("user", user);
  await next();
}

function currentUser(c: Ctx) {
  return c.get("user");
}

async function fullCurrentUser(c: Ctx) {
  const user = await getUserById(c.env.DB, currentUser(c).id);
  if (!user || user.disabled_at) {
    c.header("Set-Cookie", expiredSessionCookie());
    return null;
  }
  return user;
}

function passwordChangeRequired(user: AuthenticatedUser) {
  if (!user.force_password_change_at) return false;
  if (!user.password_changed_at) return true;
  return Date.parse(user.password_changed_at) < Date.parse(user.force_password_change_at);
}

function publicUser(user: AppUser, tags: string[] = []) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    disabled_at: user.disabled_at,
    password_change_required: passwordChangeRequired(user),
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

function valueFromSettings<T>(values: Record<string, unknown>, key: string, fallback: T): T {
  const value = values[key];
  return value == null ? fallback : value as T;
}

function buildPublicInstanceSettings(env: Env, values: Record<string, unknown>): PublicInstanceSettings {
  const name = valueFromSettings(values, "instance_name", env.INSTANCE_NAME || "QuietCollective");
  const appName = valueFromSettings(values, "app_name", name);
  const logoKey = valueFromSettings<string | null>(values, "logo_r2_key", null);
  const appIconKey = valueFromSettings<string | null>(values, "app_icon_r2_key", null);
  const maskableIconKey = valueFromSettings<string | null>(values, "app_maskable_icon_r2_key", null);
  return {
    cache_version: PUBLIC_INSTANCE_SETTINGS_CACHE_VERSION,
    name,
    site_url: valueFromSettings(values, "site_url", env.SITE_URL || ""),
    app_name: appName,
    app_short_name: valueFromSettings(values, "app_short_name", "QC"),
    app_theme_color: valueFromSettings(values, "app_theme_color", "#050505"),
    app_background_color: valueFromSettings(values, "app_background_color", "#050505"),
    source_code_url: valueFromSettings(values, "source_code_url", env.SOURCE_CODE_URL || ""),
    logo_url: logoKey ? "/api/instance/logo" : "",
    app_icon_url: appIconKey ? "/api/instance/app-icon/any" : "",
    app_maskable_icon_url: maskableIconKey ? "/api/instance/app-icon/maskable" : "",
    content_notice: valueFromSettings(values, "content_notice", "Uploaded user content remains owned by the uploader or rights holder."),
    homepage_subtitle: valueFromSettings(values, "homepage_subtitle", "Private image galleries, critique, collaborator credits, and member profiles for logged-in members."),
    login_subtitle: valueFromSettings(values, "login_subtitle", ""),
    invite_subtitle: valueFromSettings(values, "invite_subtitle", ""),
    logo_r2_key: logoKey,
    logo_content_type: valueFromSettings<string | null>(values, "logo_content_type", null),
    app_icon_r2_key: appIconKey,
    app_icon_content_type: valueFromSettings<string | null>(values, "app_icon_content_type", null),
    app_icon_updated_at: valueFromSettings(values, "app_icon_updated_at", ""),
    app_icon_16_r2_key: valueFromSettings<string | null>(values, "app_icon_16_r2_key", null),
    app_icon_16_content_type: valueFromSettings<string | null>(values, "app_icon_16_content_type", null),
    app_icon_16_updated_at: valueFromSettings(values, "app_icon_16_updated_at", ""),
    app_icon_32_r2_key: valueFromSettings<string | null>(values, "app_icon_32_r2_key", null),
    app_icon_32_content_type: valueFromSettings<string | null>(values, "app_icon_32_content_type", null),
    app_icon_32_updated_at: valueFromSettings(values, "app_icon_32_updated_at", ""),
    app_icon_192_r2_key: valueFromSettings<string | null>(values, "app_icon_192_r2_key", null),
    app_icon_192_content_type: valueFromSettings<string | null>(values, "app_icon_192_content_type", null),
    app_icon_192_updated_at: valueFromSettings(values, "app_icon_192_updated_at", ""),
    app_maskable_icon_r2_key: maskableIconKey,
    app_maskable_icon_content_type: valueFromSettings<string | null>(values, "app_maskable_icon_content_type", null),
    app_maskable_icon_updated_at: valueFromSettings(values, "app_maskable_icon_updated_at", ""),
    app_maskable_icon_192_r2_key: valueFromSettings<string | null>(values, "app_maskable_icon_192_r2_key", null),
    app_maskable_icon_192_content_type: valueFromSettings<string | null>(values, "app_maskable_icon_192_content_type", null),
    app_maskable_icon_192_updated_at: valueFromSettings(values, "app_maskable_icon_192_updated_at", ""),
  };
}

async function publicInstanceSettingsFromD1(env: Env) {
  const placeholders = PUBLIC_INSTANCE_SETTING_KEYS.map(() => "?").join(", ");
  const rows = await env.DB.prepare(`SELECT key, value_json FROM instance_settings WHERE key IN (${placeholders})`)
    .bind(...PUBLIC_INSTANCE_SETTING_KEYS)
    .all<{ key: string; value_json: string }>();
  const values: Record<string, unknown> = {};
  for (const row of rows.results) values[row.key] = parseJson<{ value?: unknown }>(row.value_json, {}).value;
  return buildPublicInstanceSettings(env, values);
}

async function publicInstanceSettings(env: Env, options: { refresh?: boolean } = {}) {
  if (!options.refresh && env.SETTINGS_CACHE) {
    const cached = await env.SETTINGS_CACHE
      .get<PublicInstanceSettings>(PUBLIC_INSTANCE_SETTINGS_CACHE_KEY, { type: "json", cacheTtl: 60 })
      .catch(() => null);
    if (cached?.cache_version === PUBLIC_INSTANCE_SETTINGS_CACHE_VERSION) return cached;
  }
  const settings = await publicInstanceSettingsFromD1(env);
  await env.SETTINGS_CACHE?.put(PUBLIC_INSTANCE_SETTINGS_CACHE_KEY, JSON.stringify(settings)).catch(() => undefined);
  return settings;
}

async function refreshPublicInstanceSettings(env: Env) {
  return publicInstanceSettings(env, { refresh: true });
}

async function instanceInfo(env: Env) {
  const settings = await publicInstanceSettings(env);
  return {
    name: settings.name,
    site_url: settings.site_url,
    app_name: settings.app_name,
    app_short_name: settings.app_short_name,
    app_theme_color: settings.app_theme_color,
    app_background_color: settings.app_background_color,
    source_code_url: settings.source_code_url,
    logo_url: settings.logo_url,
    app_icon_url: settings.app_icon_url,
    app_maskable_icon_url: settings.app_maskable_icon_url,
    content_notice: settings.content_notice,
    homepage_subtitle: settings.homepage_subtitle,
    login_subtitle: settings.login_subtitle,
    invite_subtitle: settings.invite_subtitle,
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

function galleryServerVisible(gallery: Pick<GalleryRow, "visibility" | "ownership_type" | "whole_server_upload">) {
  return gallery.ownership_type === "whole_server" || !!gallery.whole_server_upload || gallery.visibility === "server_public";
}

async function galleryCapabilities(db: D1Database, user: AuthenticatedUser, galleryId: string): Promise<GalleryCapabilities> {
  const gallery = await db.prepare("SELECT * FROM galleries WHERE id = ?").bind(galleryId).first<GalleryRow>();
  if (!gallery) return EMPTY_CAPABILITIES;
  if (ownsGallery(user, gallery)) return OWNER_CAPABILITIES;
  const wholeServerUpload = !!gallery.whole_server_upload || gallery.ownership_type === "whole_server";
  const baseCaps = wholeServerUpload
    ? { ...EMPTY_CAPABILITIES, view: true, upload_work: true, comment: true }
    : gallery.visibility === "server_public"
      ? { ...EMPTY_CAPABILITIES, view: true, comment: true }
      : { ...EMPTY_CAPABILITIES };

  const member = await db.prepare(
    `SELECT can_view, can_edit, can_upload_work, can_comment, can_manage_collaborators
     FROM gallery_members WHERE gallery_id = ? AND user_id = ?`,
  ).bind(galleryId, user.id).first<NonNullable<GalleryMemberPermissions>>();

  return resolveGalleryCapabilities({ baseCaps, gallery, member });
}

async function getWork(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM works WHERE id = ? AND deleted_at IS NULL").bind(id).first<WorkRow>();
}

const FEEDBACK_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function feedbackRequestActive(work: WorkRow) {
  if (!work.feedback_requested) return false;
  const requestedAt = Date.parse(work.feedback_requested_at || work.updated_at || work.created_at);
  if (!Number.isFinite(requestedAt)) return true;
  return Date.now() - requestedAt < FEEDBACK_REQUEST_TTL_MS;
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

async function workCapabilities(db: D1Database, user: AuthenticatedUser, workId: string) {
  const work = await getWork(db, workId);
  if (!work) return { exists: false, work: null, caps: EMPTY_CAPABILITIES, version: false, crosspost: false };
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
    `SELECT COUNT(*) AS row_count,
            MAX(can_edit) AS can_edit,
            MAX(can_version) AS can_version,
            MAX(can_comment) AS can_comment
     FROM work_collaborators
     WHERE work_id = ? AND user_id = ?`,
  ).bind(workId, user.id).first<{ row_count: number; can_edit: number | null; can_version: number | null; can_comment: number | null }>();
  const collaborator = collab && collab.row_count > 0
    ? {
        can_edit: collab.can_edit || 0,
        can_version: collab.can_version || 0,
        can_comment: collab.can_comment || 0,
      }
    : null;
  const resolved = resolveWorkCapabilities({ galleryCaps, work, user, collaborator });
  return { exists: true, work, ...resolved };
}

function galleryVisibilityRank(gallery: Pick<GalleryRow, "visibility" | "ownership_type" | "whole_server_upload">) {
  return galleryServerVisible(gallery) ? 2 : 1;
}

async function workVisibilityRank(db: D1Database, workId: string) {
  const row = await db.prepare(
    `SELECT MAX(CASE
       WHEN galleries.visibility = 'server_public'
         OR galleries.ownership_type = 'whole_server'
         OR galleries.whole_server_upload = 1
       THEN 2 ELSE 1 END) AS rank
     FROM work_galleries
     JOIN galleries ON galleries.id = work_galleries.gallery_id
     WHERE work_galleries.work_id = ?`,
  ).bind(workId).first<{ rank: number | null }>();
  return Number(row?.rank || 0);
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

async function assertGalleryCrosspostTarget(c: Ctx, galleryId: string) {
  const user = currentUser(c);
  const gallery = await c.env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(galleryId).first<GalleryRow>();
  if (!gallery) return { ok: false as const, response: c.json({ error: "Not found" }, 404) };
  const caps = await galleryCapabilities(c.env.DB, user, galleryId);
  if (!canCrosspostToGallery({ caps, gallery, user })) return { ok: false as const, response: c.json({ error: "Forbidden" }, 403) };
  return { ok: true as const, gallery, caps };
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

async function assertWorkCrosspostCapability(c: Ctx, workId: string) {
  const result = await workCapabilities(c.env.DB, currentUser(c), workId);
  if (!result.exists) return { ok: false as const, response: c.json({ error: "Not found" }, 404) };
  if (!result.crosspost) return { ok: false as const, response: c.json({ error: "Forbidden" }, 403) };
  return { ok: true as const, ...result };
}

async function canViewTarget(db: D1Database, user: AuthenticatedUser, targetType: string, targetId: string): Promise<boolean> {
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

async function canCommentTarget(db: D1Database, user: AuthenticatedUser, targetType: string, targetId: string): Promise<boolean> {
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

async function canUserViewTarget(db: D1Database, userId: string, targetType: string | null, targetId: string | null) {
  if (!targetType || !targetId) return false;
  const user = await getUserById(db, userId);
  return user && !user.disabled_at ? canViewTarget(db, user, targetType, targetId) : false;
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
  await bumpApiCacheToken(env.DB).catch(() => undefined);
  await sendBrowserPushNotifications(env, userId).catch((error: unknown) => console.error("web push notification failed", error));
}

async function sendBrowserPushNotifications(env: Env, userId: string) {
  if (!webPushConfigured(env)) return;
  const rows = await env.DB.prepare(
    `SELECT id, endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id = ?
       AND disabled_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 20`,
  ).bind(userId).all<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  for (const row of rows.results) {
    const timestamp = now();
    try {
      const result = await sendWebPushTickle(env, row);
      if (result.ok) {
        await env.DB.prepare(
          `UPDATE push_subscriptions
           SET last_success_at = ?,
               last_error_at = NULL,
               error_count = 0,
               updated_at = ?
           WHERE id = ?`,
        ).bind(timestamp, timestamp, row.id).run();
        continue;
      }
      await recordPushFailure(env.DB, row.id, result.gone);
    } catch (error: unknown) {
      console.error("web push send failed", error);
      await recordPushFailure(env.DB, row.id, false);
    }
  }
}

async function recordPushFailure(db: D1Database, subscriptionId: string, gone = false) {
  const timestamp = now();
  await db.prepare(
    `UPDATE push_subscriptions
     SET last_error_at = ?,
         error_count = error_count + 1,
         disabled_at = CASE
           WHEN ? = 1 THEN COALESCE(disabled_at, ?)
           WHEN error_count >= 4 THEN COALESCE(disabled_at, ?)
           ELSE disabled_at
         END,
         updated_at = ?
     WHERE id = ?`,
  ).bind(timestamp, gone ? 1 : 0, timestamp, timestamp, timestamp, subscriptionId).run();
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

  if (event.type === "comment.created" && event.target_type === "gallery" && event.target_id) {
    const gallery = await env.DB.prepare("SELECT owner_user_id, created_by, title FROM galleries WHERE id = ?").bind(event.target_id).first<{ owner_user_id: string; created_by: string; title: string }>();
    if (gallery) {
      targets.add(gallery.owner_user_id);
      targets.add(gallery.created_by);
      body = `New comment on gallery "${gallery.title}"`;
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
      for (const row of mentioned.results) {
        if (await canUserViewTarget(env.DB, row.id, event.target_type, event.target_id)) targets.add(row.id);
      }
      body = "You were mentioned in a comment";
    }
  }

  if (event.type === "work.collaborator_added" || event.type === "work.collaborator_updated") {
    const userId = typeof payload.user_id === "string" ? payload.user_id : null;
    if (userId) targets.add(userId);
    body = event.type === "work.collaborator_added" ? "You were added as a contributor" : "Your contributor credit was updated";
  }

  if (event.type === "work.version_created") {
    for (const userId of await linkedWorkCollaborators(env.DB, event.subject_id)) targets.add(userId);
    body = "A collaborative work has a new version";
  }

  if (event.type === "work.crossposted") {
    const work = await getWork(env.DB, event.subject_id);
    if (work) {
      targets.add(work.created_by);
      for (const userId of await linkedWorkCollaborators(env.DB, work.id)) targets.add(userId);
      if (event.target_type === "gallery" && event.target_id) {
        for (const userId of await galleryAttachedUsers(env.DB, event.target_id)) targets.add(userId);
      }
      body = `Work crossposted: ${work.title}`;
    }
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
    if (targetType === "gallery") {
      const gallery = await env.DB.prepare("SELECT owner_user_id, created_by, title FROM galleries WHERE id = ?").bind(targetId).first<{ owner_user_id: string; created_by: string; title: string }>();
      if (gallery) {
        targets.add(gallery.owner_user_id);
        targets.add(gallery.created_by);
        body = `Someone liked your gallery "${gallery.title}"`;
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

async function galleryAccessUsers(db: D1Database, galleryId: string, capability: "can_view" | "can_upload_work") {
  const rows = await db.prepare(
    `SELECT users.handle, users.display_name
     FROM gallery_members
     JOIN users ON users.id = gallery_members.user_id
     WHERE gallery_members.gallery_id = ?
       AND gallery_members.${capability} = 1
       AND users.disabled_at IS NULL
     ORDER BY CASE WHEN gallery_members.role_label = 'owner' THEN 0 ELSE 1 END,
              users.handle COLLATE NOCASE`,
  ).bind(galleryId).all<{ handle: string; display_name: string }>();
  return rows.results;
}

async function serializeGallery(env: Env, user: AuthenticatedUser, gallery: GalleryRow) {
  const [pinned, ownership, submitters, viewers, workCount, reaction] = await Promise.all([
    env.DB.prepare("SELECT pinned_at FROM user_gallery_pins WHERE user_id = ? AND gallery_id = ?")
      .bind(user.id, gallery.id)
      .first<{ pinned_at: string }>(),
    env.DB.prepare(
      `SELECT owner.handle AS owner_handle,
              owner.display_name AS owner_display_name,
              COUNT(DISTINCT CASE WHEN gallery_members.can_view = 1 THEN gallery_members.user_id END) AS viewer_count
       FROM galleries
       JOIN users AS owner ON owner.id = galleries.owner_user_id
       LEFT JOIN gallery_members ON gallery_members.gallery_id = galleries.id
       WHERE galleries.id = ?
       GROUP BY owner.id`,
    ).bind(gallery.id).first<{ owner_handle: string; owner_display_name: string; viewer_count: number }>(),
    galleryAccessUsers(env.DB, gallery.id, "can_upload_work"),
    galleryAccessUsers(env.DB, gallery.id, "can_view"),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT works.id) AS count
       FROM work_galleries
       JOIN works ON works.id = work_galleries.work_id
       WHERE work_galleries.gallery_id = ?
         AND works.deleted_at IS NULL`,
    ).bind(gallery.id).first<{ count: number }>(),
    reactionSummary(env.DB, user, "gallery", gallery.id),
  ]);
  const viewerCount = viewers.length || Number(ownership?.viewer_count || 0);
  const submitterCount = submitters.length;
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
    reactions: reaction,
    pinned: !!pinned,
    pinned_at: pinned?.pinned_at || null,
    work_count: workCount?.count || 0,
    ownership_summary: {
      owner_handle: ownership?.owner_handle || null,
      owner_display_name: ownership?.owner_display_name || null,
      viewer_count: viewerCount,
      additional_viewer_count: Math.max(0, viewerCount - 1),
      submitters: submitters.slice(0, 2),
      submitter_count: submitterCount,
      additional_submitter_count: Math.max(0, submitterCount - 2),
      viewers: viewers.slice(0, 2),
      additional_visible_viewer_count: Math.max(0, viewerCount - 2),
    },
    cover_image_url: coverVersion?.thumbnail_r2_key
      ? (await signedMediaUrl(env, coverVersion.thumbnail_r2_key, coverVersion.thumbnail_content_type, "thumbnail")) || `/api/media/works/${coverVersion.work_id}/versions/${coverVersion.id}/thumbnail`
      : gallery.cover_image_key
        ? (await signedMediaUrl(env, gallery.cover_image_key, gallery.cover_image_content_type, "thumbnail")) || `/api/media/galleries/${gallery.id}/cover`
        : null,
  };
}

async function reactionSummary(db: D1Database, user: AuthenticatedUser, targetType: "work" | "comment" | "gallery", targetId: string) {
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

async function serializeWork(env: Env, user: AuthenticatedUser, work: WorkRow) {
  const currentVersion = work.current_version_id
    ? await env.DB.prepare("SELECT * FROM work_versions WHERE id = ?").bind(work.current_version_id).first<WorkVersionRow>()
    : null;
  const caps = await workCapabilities(env.DB, user, work.id);
  const [reaction, feedbackDismissal, linkedGalleries, creator] = await Promise.all([
    reactionSummary(env.DB, user, "work", work.id),
    env.DB.prepare("SELECT dismissed_at FROM feedback_request_dismissals WHERE work_id = ? AND user_id = ?").bind(work.id, user.id).first<{ dismissed_at: string }>(),
    workGalleryLinks(env.DB, work),
    env.DB.prepare("SELECT handle, display_name FROM users WHERE id = ?").bind(work.created_by).first<{ handle: string; display_name: string }>(),
  ]);
  const galleries = [];
  for (const gallery of linkedGalleries) {
    const serialized = await serializeGallery(env, user, gallery);
    if (serialized.capabilities.view) galleries.push(serialized);
  }
  const feedbackRequested = feedbackRequestActive(work);
  return {
    ...work,
    created_by_user: creator || null,
    gallery_title: galleries[0]?.title || "",
    galleries,
    feedback_requested: feedbackRequested,
    feedback_dismissed: feedbackRequested && !!feedbackDismissal,
    feedback_dismissed_at: feedbackDismissal?.dismissed_at || null,
    is_owner: work.created_by === user.id,
    reactions: reaction,
    capabilities: caps.caps,
    can_create_version: caps.version,
    can_crosspost: caps.crosspost,
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
  created_by_handle: string | null;
  created_by_display_name: string | null;
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
  collaborator_can_edit: number | null;
  collaborator_can_version: number | null;
  collaborator_can_comment: number | null;
};

async function serializeGalleryWorkListItem(env: Env, user: AuthenticatedUser, row: GalleryWorkListRow, caps: GalleryCapabilities) {
  const collaborator = row.collaborator_can_edit == null && row.collaborator_can_version == null && row.collaborator_can_comment == null
    ? null
    : {
        can_edit: row.collaborator_can_edit || 0,
        can_version: row.collaborator_can_version || 0,
        can_comment: row.collaborator_can_comment || 0,
      };
  const resolved = resolveWorkCapabilities({ galleryCaps: caps, work: row, user, collaborator });
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
    created_by_user: row.created_by_handle ? {
      handle: row.created_by_handle,
      display_name: row.created_by_display_name,
    } : null,
    feedback_requested: feedbackRequestActive(row),
    feedback_dismissed: feedbackRequestActive(row) && !!row.feedback_dismissed_at,
    feedback_dismissed_at: row.feedback_dismissed_at,
    is_owner: row.created_by === user.id,
    reactions: {
      heart_count: row.heart_count || 0,
      hearted_by_me: !!row.hearted_by_me,
    },
    capabilities: resolved.caps,
    can_create_version: resolved.version,
    current_version: currentVersion,
  };
}

async function putR2File(bucket: R2Bucket, key: string, file: File, metadata: Record<string, string> = {}) {
  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: metadata,
  });
}

registerRoutes(app, {
  prepareApiCache,
  readBody,
  getUserById,
  getUserByHandle,
  ensureWorkRoleSuggestion,
  requireUser,
  currentUser,
  fullCurrentUser,
  publicUser,
  getTags,
  getSetting,
  setSetting,
  publicInstanceSettings,
  refreshPublicInstanceSettings,
  instanceInfo,
  adminCount,
  isAdmin,
  galleryCapabilities,
  getWork,
  workGalleryLinks,
  workCapabilities,
  galleryVisibilityRank,
  workVisibilityRank,
  assertGalleryCapability,
  assertGalleryCrosspostTarget,
  assertWorkCapability,
  assertWorkCrosspostCapability,
  canViewTarget,
  canCommentTarget,
  insertEvent,
  processEvent,
  serializeGallery,
  reactionSummary,
  serializeWork,
  serializeVersion,
  serializeGalleryWorkListItem,
  putR2File,
});

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
