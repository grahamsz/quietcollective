import { cors } from "hono/cors";
import { logger } from "hono/logger";
import * as bcrypt from "bcryptjs";
import { ulid } from "ulid";
import {
  addR2ArchiveEntry,
  archiveSafeName,
  createZip,
  type ExportWorkVersionRow,
  type ZipEntry,
  worksCsv,
} from "./archive";
import {
  ACTIVITY_CONTEXT_SELECT,
  activityEntryFromJoinedRow,
  collectActivityVisibilityIds,
  joinedEventVisible,
  type ActivityJoinedRow,
  type NotificationActivityJoinedRow,
  visibleGalleryIds,
  visibleWorkIds,
} from "./activity";
import { apiNotModified, bumpApiCacheToken, cacheableJson, etagMatches, mutatingApiRequest, sanitizeEtagPart } from "./api-cache";
import { base64Url, sha256 } from "./crypto";
import { readSignedMediaPayload, signedMediaUrl } from "./media";
import { createSession, expiredSessionCookie, sessionCookie } from "./sessions";
import type { AppContext, Ctx } from "./app-context";
import { BROWSER_NOTIFICATION_ACTIVE_POLL_INTERVAL_MS, BROWSER_NOTIFICATION_IDLE_POLL_INTERVAL_MS, BROWSER_NOTIFICATION_ACTIVE_WINDOW_MS, POPULAR_TAG_WINDOW_DAYS, ROLE_SUGGESTIONS } from "./constants";
import type { AppUser, Env, GalleryRow, WorkRow, WorkVersionRow } from "./types";
import { cacheControl, fileField, jsonText, normalizeClientUploadKey, normalizeGalleryOwnership, normalizeHandle, normalizeRoleLabel, normalizeTag, now, numberField, parseJson, recordTagUse, recordTextTags, stringField, truthy } from "./utils";
import type { RouteApp, RouteDeps } from "./routes/types";

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

export function registerRoutes(app: RouteApp, deps: RouteDeps) {
  const { prepareApiCache, readBody, getUserById, getUserByHandle, requireUser, currentUser, publicUser, getTags, getSetting, setSetting, instanceInfo, adminCount, isAdmin, galleryCapabilities, getWork, workGalleryLinks, workCapabilities, galleryVisibilityRank, workVisibilityRank, assertGalleryCapability, assertWorkCapability, assertWorkCrosspostCapability, canViewTarget, canCommentTarget, insertEvent, processEvent, serializeGallery, reactionSummary, serializeWork, serializeVersion, serializeGalleryWorkListItem, putR2File, ensureWorkRoleSuggestion } = deps;

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
  if (mutatingApiRequest(c)) {
    await bumpApiCacheToken(c.env.DB).catch(() => undefined);
  }
  if (c.req.path.startsWith("/api/") && !c.req.path.startsWith("/api/media/")) {
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  }
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
});

app.get("/api/health", (c) => c.json({ ok: true, service: "quietcollective" }));

app.get("/api/openapi.yaml", async (c) => c.env.ASSETS.fetch(c.req.raw));

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
  const key = await getSetting(c.env.DB, "logo_r2_key", null) as string | null;
  const contentType = await getSetting(c.env.DB, "logo_content_type", null) as string | null;
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
app.use("/api/notifications", requireUser);
app.use("/api/notifications/*", requireUser);
app.use("/api/exports", requireUser);
app.use("/api/exports/*", requireUser);
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

  await insertEvent(c.env, "user.joined", id, "user", id).catch((error: unknown) => console.error("user.joined event failed", error));
  await insertEvent(c.env, "invite.accepted", id, "invite", invite!.id, "user", id, { invite_id: invite!.id }).catch((error: unknown) => console.error("invite.accepted event failed", error));
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
  const cache = await prepareApiCache(c, "galleries");
  if (cache.fresh) return apiNotModified(cache);
  const rows = await c.env.DB.prepare("SELECT * FROM galleries ORDER BY updated_at DESC LIMIT 200").all<GalleryRow>();
  const galleries = [];
  for (const gallery of rows.results) {
    const serialized = await serializeGallery(c.env, user, gallery);
    if (serialized.capabilities.view) galleries.push(serialized);
  }
  return cacheableJson(c, cache, { galleries });
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
  const cache = await prepareApiCache(c, `gallery:${c.req.param("id")}`);
  if (cache.fresh) return apiNotModified(cache);
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
              creators.handle AS created_by_handle,
              creators.display_name AS created_by_display_name,
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
              feedback_request_dismissals.dismissed_at AS feedback_dismissed_at,
              current_work_collaborator.can_edit AS collaborator_can_edit,
              current_work_collaborator.can_version AS collaborator_can_version,
              current_work_collaborator.can_comment AS collaborator_can_comment
       FROM works
       JOIN work_galleries ON work_galleries.work_id = works.id
       JOIN users AS creators ON creators.id = works.created_by
       LEFT JOIN work_versions ON work_versions.id = works.current_version_id
       LEFT JOIN reactions ON reactions.target_type = 'work'
         AND reactions.target_id = works.id
         AND reactions.reaction = 'heart'
       LEFT JOIN feedback_request_dismissals ON feedback_request_dismissals.work_id = works.id
         AND feedback_request_dismissals.user_id = ?
       LEFT JOIN work_collaborators AS current_work_collaborator ON current_work_collaborator.work_id = works.id
         AND current_work_collaborator.user_id = ?
       WHERE work_galleries.gallery_id = ? AND works.deleted_at IS NULL
       GROUP BY works.id
       ORDER BY work_galleries.updated_at DESC, works.updated_at DESC`,
    ).bind(user.id, user.id, user.id, gallery.id).all<GalleryWorkListRow>(),
  ]);
  return cacheableJson(c, cache, {
    gallery: await serializeGallery(c.env, user, gallery),
    members: members.results,
    works: await Promise.all(works.results.map((work) => serializeGalleryWorkListItem(c.env, user, work, gate.caps))),
  });
});

app.get("/api/galleries/:id/crosspost-candidates", async (c) => {
  const galleryId = c.req.param("id");
  const galleryGate = await assertGalleryCapability(c, galleryId, "upload_work");
  if (!galleryGate.ok) return galleryGate.response;
  const user = currentUser(c);
  const gallery = await c.env.DB.prepare("SELECT * FROM galleries WHERE id = ?").bind(galleryId).first<GalleryRow>();
  if (!gallery) return c.json({ error: "Not found" }, 404);
  const targetRank = galleryVisibilityRank(gallery);
  const rows = await c.env.DB.prepare(
    `SELECT works.*,
            CASE WHEN works.created_by = ? THEN 'owner' ELSE 'collaborator' END AS relationship
     FROM works
     WHERE works.deleted_at IS NULL
       AND (
         works.created_by = ?
         OR EXISTS (
           SELECT 1 FROM work_collaborators
           WHERE work_collaborators.work_id = works.id
             AND work_collaborators.user_id = ?
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM work_galleries
         WHERE work_galleries.work_id = works.id
           AND work_galleries.gallery_id = ?
       )
     ORDER BY works.updated_at DESC
     LIMIT 100`,
  ).bind(user.id, user.id, user.id, galleryId).all<WorkRow & { relationship: "owner" | "collaborator" }>();

  const works = [];
  for (const work of rows.results) {
    const serialized = await serializeWork(c.env, user, work);
    const currentRank = await workVisibilityRank(c.env.DB, work.id);
    const increasesVisibility = targetRank > currentRank;
    works.push({
      ...serialized,
      crosspost: {
        relationship: work.relationship,
        increases_visibility: increasesVisibility,
        warning: increasesVisibility
          ? `Adding this work to "${gallery.title}" will make it visible to everyone who can view that gallery.`
          : null,
      },
    });
  }

  return c.json({ gallery: await serializeGallery(c.env, user, gallery), works });
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
  const workGate = await assertWorkCrosspostCapability(c, c.req.param("id"));
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
  await insertEvent(c.env, "work.crossposted", currentUser(c).id, "work", workGate.work!.id, "gallery", galleryId, { crossposted_to_gallery_id: galleryId });
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
  if (!targetType || !targetId) return c.json({ error: "target_type and target_id are required" }, 400);
  if (!(await canViewTarget(c.env.DB, currentUser(c), targetType, targetId))) return c.json({ error: "Forbidden" }, 403);
  const cache = await prepareApiCache(c, `comments:${targetType}:${targetId}`);
  if (cache.fresh) return apiNotModified(cache);
  const rows = await c.env.DB.prepare(
    `SELECT comments.*, users.display_name, users.handle,
            parent_comments.body AS parent_body,
            parent_users.display_name AS parent_display_name,
            parent_users.handle AS parent_handle,
            COUNT(reactions.id) AS heart_count,
            MAX(CASE WHEN reactions.user_id = ? THEN 1 ELSE 0 END) AS hearted_by_me
     FROM comments
     JOIN users ON users.id = comments.author_id
     LEFT JOIN comments AS parent_comments ON parent_comments.id = comments.parent_comment_id AND parent_comments.deleted_at IS NULL
     LEFT JOIN users AS parent_users ON parent_users.id = parent_comments.author_id
     LEFT JOIN reactions ON reactions.target_type = 'comment'
       AND reactions.target_id = comments.id
       AND reactions.reaction = 'heart'
     WHERE comments.target_type = ? AND comments.target_id = ? AND comments.deleted_at IS NULL
     GROUP BY comments.id
     ORDER BY comments.created_at ASC`,
  ).bind(currentUser(c).id, targetType, targetId).all<Record<string, unknown> & { heart_count: number; hearted_by_me: number | null }>();
  const comments = rows.results.map((comment) => ({
    ...comment,
    reactions: {
      heart_count: comment.heart_count || 0,
      hearted_by_me: !!comment.hearted_by_me,
    },
  }));
  return cacheableJson(c, cache, { comments });
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

app.get("/api/tags/popular", async (c) => {
  const user = currentUser(c);
  const cache = await prepareApiCache(c, "tags:popular");
  if (cache.fresh) return apiNotModified(cache);
  const cutoff = new Date(Date.now() - POPULAR_TAG_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const visibleGallerySql = (alias: string) => `(? = 'admin' OR ${alias}.owner_user_id = ? OR ${alias}.created_by = ? OR ${alias}.visibility = 'server_public' OR ${alias}.whole_server_upload = 1 OR EXISTS (SELECT 1 FROM gallery_members WHERE gallery_members.gallery_id = ${alias}.id AND gallery_members.user_id = ? AND gallery_members.can_view = 1))`;
  const visibleGalleryArgs = () => [user.role, user.id, user.id, user.id];
  const visibleWorkSql = (alias: string) => `(? = 'admin' OR ${alias}.created_by = ? OR EXISTS (SELECT 1 FROM work_collaborators WHERE work_collaborators.work_id = ${alias}.id AND work_collaborators.user_id = ?) OR EXISTS (SELECT 1 FROM work_galleries JOIN galleries AS tag_work_gallery ON tag_work_gallery.id = work_galleries.gallery_id WHERE work_galleries.work_id = ${alias}.id AND ${visibleGallerySql("tag_work_gallery")}))`;
  const visibleWorkArgs = () => [user.role, user.id, user.id, ...visibleGalleryArgs()];
  const tags = new Map<string, { tag: string; count: number; last_used_at: string }>();
  const [galleries, works, comments, profileTags] = await Promise.all([
    c.env.DB.prepare(
      `SELECT title, description, updated_at
       FROM galleries
       WHERE updated_at >= ? AND ${visibleGallerySql("galleries")}
       ORDER BY updated_at DESC
       LIMIT 160`,
    ).bind(cutoff, ...visibleGalleryArgs()).all<{ title: string; description: string; updated_at: string }>(),
    c.env.DB.prepare(
      `SELECT title, description, updated_at
       FROM works
       WHERE deleted_at IS NULL AND updated_at >= ? AND ${visibleWorkSql("works")}
       ORDER BY updated_at DESC
       LIMIT 240`,
    ).bind(cutoff, ...visibleWorkArgs()).all<{ title: string; description: string; updated_at: string }>(),
    c.env.DB.prepare(
      `SELECT body, created_at
       FROM comments
       WHERE deleted_at IS NULL
         AND created_at >= ?
         AND (
           target_type = 'profile'
           OR (target_type = 'gallery' AND EXISTS (SELECT 1 FROM galleries WHERE galleries.id = comments.target_id AND ${visibleGallerySql("galleries")}))
           OR (target_type = 'work' AND EXISTS (SELECT 1 FROM works WHERE works.id = comments.target_id AND works.deleted_at IS NULL AND ${visibleWorkSql("works")}))
         )
       ORDER BY created_at DESC
       LIMIT 240`,
    ).bind(cutoff, ...visibleGalleryArgs(), ...visibleWorkArgs()).all<{ body: string; created_at: string }>(),
    c.env.DB.prepare(
      `SELECT tag, created_at
       FROM medium_tags
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT 200`,
    ).bind(cutoff).all<{ tag: string; created_at: string }>(),
  ]);

  for (const row of galleries.results) recordTextTags(tags, `${row.title} ${row.description || ""}`, row.updated_at);
  for (const row of works.results) recordTextTags(tags, `${row.title} ${row.description || ""}`, row.updated_at);
  for (const row of comments.results) recordTextTags(tags, row.body || "", row.created_at);
  for (const row of profileTags.results) recordTagUse(tags, row.tag, row.created_at);

  const sorted = Array.from(tags.values())
    .sort((a, b) => b.count - a.count || b.last_used_at.localeCompare(a.last_used_at) || a.tag.localeCompare(b.tag))
    .slice(0, 5);
  return cacheableJson(c, cache, { window_days: POPULAR_TAG_WINDOW_DAYS, tags: sorted });
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

app.get("/api/activity", async (c) => {
  const user = currentUser(c);
  const cache = await prepareApiCache(c, "activity");
  if (cache.fresh) return apiNotModified(cache);
  const rows = await c.env.DB.prepare(
    `WITH recent AS (
       SELECT * FROM domain_events ORDER BY created_at DESC LIMIT 120
     )
     ${ACTIVITY_CONTEXT_SELECT}
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
  return cacheableJson(c, cache, { events });
});

app.get("/api/notifications", async (c) => {
  const user = currentUser(c);
  const cache = await prepareApiCache(c, "notifications");
  if (cache.fresh) return apiNotModified(cache);
  const rows = await c.env.DB.prepare(
    `WITH recent AS (
       SELECT domain_events.*,
              notifications.id AS notification_id,
              notifications.event_id AS notification_event_id,
              notifications.type AS notification_type,
              notifications.body AS notification_body,
              notifications.read_at AS notification_read_at,
              notifications.created_at AS notification_created_at
       FROM notifications
       JOIN domain_events ON domain_events.id = notifications.event_id
       WHERE notifications.user_id = ?
       ORDER BY notifications.created_at DESC LIMIT 100
     )
     ${ACTIVITY_CONTEXT_SELECT}
     ORDER BY recent.notification_created_at DESC`,
  ).bind(user.id).all<NotificationActivityJoinedRow>();
  const { galleryIds, workIds } = collectActivityVisibilityIds(rows.results);
  const [galleries, works] = await Promise.all([
    visibleGalleryIds(c.env.DB, user, galleryIds),
    visibleWorkIds(c.env.DB, user, workIds),
  ]);
  const thumbnailCache = new Map<string, Promise<string | null>>();
  const visibleRows = rows.results.filter((row) => joinedEventVisible(user, row, galleries, works));
  const notifications = await Promise.all(visibleRows.map(async (row) => {
    const activity = await activityEntryFromJoinedRow(c.env, user, row, thumbnailCache).catch(() => null);
    return {
      id: row.notification_id,
      event_id: row.notification_event_id,
      type: row.notification_type,
      body: row.notification_body,
      read_at: row.notification_read_at,
      created_at: row.notification_created_at,
      summary: activity?.summary || row.notification_body,
      href: activity?.href || null,
      thumbnail_url: activity?.thumbnail_url || null,
      comment_preview: activity?.comment_preview || null,
    };
  }));
  return cacheableJson(c, cache, { notifications });
});

app.get("/api/notifications/poll", async (c) => {
  const user = currentUser(c);
  const since = stringField(c.req.query("since"), "");
  const watermark = await c.env.DB.prepare(
    "SELECT COUNT(*) AS unread_count, MAX(created_at) AS latest_created_at FROM notifications WHERE user_id = ? AND read_at IS NULL",
  ).bind(user.id).first<{ unread_count: number; latest_created_at: string | null }>();
  const etag = `W/"qc:notifications-poll:${sanitizeEtagPart(user.id)}:${sanitizeEtagPart(since || "all")}:${watermark?.unread_count || 0}:${sanitizeEtagPart(watermark?.latest_created_at || "none")}"`;
  const cache = { etag, fresh: etagMatches(c.req.header("if-none-match"), etag) };
  if (cache.fresh) return apiNotModified(cache);
  const rows = await c.env.DB.prepare(
    `SELECT id, type, title, body, action_url, created_at
     FROM notifications
     WHERE user_id = ?
       AND read_at IS NULL
       AND (? = '' OR created_at > ?)
     ORDER BY created_at DESC
     LIMIT 5`,
  ).bind(user.id, since, since).all<{ id: string; type: string; title: string; body: string; action_url: string | null; created_at: string }>();
  c.header("X-Active-Poll-Interval-Ms", String(BROWSER_NOTIFICATION_ACTIVE_POLL_INTERVAL_MS));
  c.header("X-Idle-Poll-Interval-Ms", String(BROWSER_NOTIFICATION_IDLE_POLL_INTERVAL_MS));
  return cacheableJson(c, cache, {
    active_interval_ms: BROWSER_NOTIFICATION_ACTIVE_POLL_INTERVAL_MS,
    idle_interval_ms: BROWSER_NOTIFICATION_IDLE_POLL_INTERVAL_MS,
    active_window_ms: BROWSER_NOTIFICATION_ACTIVE_WINDOW_MS,
    unread_count: watermark?.unread_count || 0,
    latest_created_at: watermark?.latest_created_at || null,
    notifications: rows.results,
  });
});

app.post("/api/notifications/:id/read", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?").bind(now(), c.req.param("id"), currentUser(c).id).run();
  return c.json({ ok: true });
});

app.post("/api/notifications/read-all", async (c) => {
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND read_at IS NULL").bind(now(), currentUser(c).id).run();
  return c.json({ ok: true });
});

type ExportWorkGalleryRow = {
  work_id: string;
  gallery_id: string;
  gallery_title: string;
};

type ExportAsset = {
  kind: string;
  path: string;
  work_id?: string;
  version_id?: string;
  r2_key?: string;
  content_type?: string | null;
  size_bytes?: number;
  missing?: boolean;
};

type ExportJobCleanupRow = {
  id: string;
  manifest_r2_key: string | null;
  archive_r2_key: string | null;
};

const EXPORT_UNDOWNLOADED_TTL_DAYS = 7;

function isoDaysAfter(value: string, days: number) {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}

async function cleanupExpiredUndownloadedExports(env: Env, userId: string) {
  const cutoff = new Date(Date.now() - EXPORT_UNDOWNLOADED_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const expired = await env.DB.prepare(
    `SELECT id, manifest_r2_key, archive_r2_key
     FROM export_jobs
     WHERE user_id = ?
       AND status = 'ready'
       AND downloaded_at IS NULL
       AND (
         (expires_at IS NOT NULL AND expires_at <= ?)
         OR (expires_at IS NULL AND COALESCE(completed_at, updated_at, created_at) <= ?)
       )`,
  ).bind(userId, now(), cutoff).all<ExportJobCleanupRow>();

  for (const job of expired.results) {
    const keys = [job.manifest_r2_key, job.archive_r2_key].filter((key): key is string => !!key);
    if (keys.length) await env.MEDIA.delete(keys).catch(() => undefined);
    await env.DB.prepare("DELETE FROM export_jobs WHERE id = ? AND user_id = ? AND downloaded_at IS NULL").bind(job.id, userId).run();
  }
}

async function buildExport(env: Env, user: AppUser, exportId: string) {
  const tags = await getTags(env.DB, user.id);
  const encoder = new TextEncoder();
  const galleries = await env.DB.prepare("SELECT * FROM galleries WHERE owner_user_id = ? OR created_by = ?").bind(user.id, user.id).all();
  const works = await env.DB.prepare("SELECT * FROM works WHERE created_by = ? AND deleted_at IS NULL ORDER BY updated_at DESC").bind(user.id).all<WorkRow>();
  const workVersions = await env.DB.prepare(
    `SELECT work_versions.*, works.title AS work_title
     FROM work_versions JOIN works ON works.id = work_versions.work_id
     WHERE works.created_by = ? AND works.deleted_at IS NULL
     ORDER BY works.updated_at DESC, work_versions.version_number`,
  ).bind(user.id).all<ExportWorkVersionRow>();
  const workGalleries = await env.DB.prepare(
    `SELECT work_galleries.work_id, galleries.id AS gallery_id, galleries.title AS gallery_title
     FROM work_galleries
     JOIN works ON works.id = work_galleries.work_id
     JOIN galleries ON galleries.id = work_galleries.gallery_id
     WHERE works.created_by = ? AND works.deleted_at IS NULL
     ORDER BY galleries.title COLLATE NOCASE`,
  ).bind(user.id).all<ExportWorkGalleryRow>();
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

  const galleriesByWork = new Map<string, string[]>();
  for (const row of workGalleries.results) {
    const galleriesForWork = galleriesByWork.get(row.work_id) || [];
    galleriesForWork.push(row.gallery_title);
    galleriesByWork.set(row.work_id, galleriesForWork);
  }

  const entries: ZipEntry[] = [];
  const assets: ExportAsset[] = [];
  const assetsByWork = new Map<string, string[]>();

  for (const version of workVersions.results) {
    const originalIsWebp = !!version.original_r2_key && (version.original_content_type || "").toLowerCase().includes("webp");
    const mediaKey = version.preview_r2_key || (originalIsWebp ? version.original_r2_key : null);
    const mediaType = version.preview_r2_key ? version.preview_content_type : version.original_content_type;
    if (!mediaKey) continue;
    const workName = archiveSafeName(version.work_title, version.work_id);
    const path = `media/high-res/${workName}-${version.work_id}-v${version.version_number}.webp`;
    const size = await addR2ArchiveEntry(env.MEDIA, entries, mediaKey, path);
    const asset: ExportAsset = {
      kind: "high_res_webp",
      path,
      work_id: version.work_id,
      version_id: version.id,
      r2_key: mediaKey,
      content_type: mediaType,
      missing: size == null,
      ...(size == null ? {} : { size_bytes: size }),
    };
    assets.push(asset);
    if (size != null) {
      const workAssets = assetsByWork.get(version.work_id) || [];
      workAssets.push(path);
      assetsByWork.set(version.work_id, workAssets);
    }
  }

  const manifest = {
    export_id: exportId,
    generated_at: now(),
    undownloaded_expires_after_days: EXPORT_UNDOWNLOADED_TTL_DAYS,
    content_notice: "Uploaded user content remains owned by the uploader or rights holder.",
    profile: publicUser(user, tags),
    medium_tags: tags,
    owned_galleries: galleries.results,
    owned_works: works.results,
    work_versions: workVersions.results,
    work_gallery_links: workGalleries.results,
    writing_content: writing.results,
    collaborator_records: collaborators.results,
    comments: comments.results,
    events: events.results,
    notifications: notifications.results,
    assets,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestKey = `exports/${user.id}/${exportId}/manifest.json`;
  const archiveKey = `exports/${user.id}/${exportId}/quietcollective-export-${exportId}.zip`;
  const expiresAt = isoDaysAfter(manifest.generated_at, EXPORT_UNDOWNLOADED_TTL_DAYS);
  entries.unshift(
    { path: "data/export.json", data: encoder.encode(manifestJson) },
    { path: "works.csv", data: encoder.encode(worksCsv(works.results, workVersions.results, galleriesByWork, assetsByWork)) },
  );
  const archive = createZip(entries);

  await env.MEDIA.put(manifestKey, manifestJson, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { owner: user.id, kind: "export_manifest" },
  });
  await env.MEDIA.put(archiveKey, archive, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { owner: user.id, kind: "export_archive" },
  });
  await env.DB.prepare(
    "UPDATE export_jobs SET status = 'ready', manifest_r2_key = ?, archive_r2_key = ?, archive_content_type = 'application/zip', archive_size_bytes = ?, expires_at = ?, updated_at = ?, completed_at = ? WHERE id = ?",
  ).bind(manifestKey, archiveKey, archive.length, expiresAt, now(), now(), exportId).run();
  await insertEvent(env, "export.ready", user.id, "export", exportId);
  return manifest;
}

app.post("/api/exports/me", async (c) => {
  const user = currentUser(c);
  await cleanupExpiredUndownloadedExports(c.env, user.id);
  const id = ulid();
  const timestamp = now();
  await c.env.DB.prepare("INSERT INTO export_jobs (id, user_id, status, expires_at, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?, ?)")
    .bind(id, user.id, isoDaysAfter(timestamp, EXPORT_UNDOWNLOADED_TTL_DAYS), timestamp, timestamp).run();
  const manifest = await buildExport(c.env, user, id);
  return c.json({ export: { id, status: "ready", archive_url: `/api/exports/${id}` }, manifest }, 201);
});

app.get("/api/exports/me", async (c) => {
  const user = currentUser(c);
  await cleanupExpiredUndownloadedExports(c.env, user.id);
  const rows = await c.env.DB.prepare("SELECT * FROM export_jobs WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
  return c.json({ exports: rows.results });
});

app.get("/api/exports/:id", async (c) => {
  const user = currentUser(c);
  await cleanupExpiredUndownloadedExports(c.env, user.id);
  const job = await c.env.DB.prepare("SELECT * FROM export_jobs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), user.id).first<{
    id: string;
    manifest_r2_key: string | null;
    archive_r2_key: string | null;
    archive_content_type: string | null;
    status: string;
  }>();
  if (!job) return c.json({ error: "Not found" }, 404);
  if (job.status !== "ready") return c.json({ status: job.status });
  const key = job.archive_r2_key || job.manifest_r2_key;
  if (!key) return c.json({ status: job.status });
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: "Export not found" }, 404);
  const isArchive = !!job.archive_r2_key;
  await c.env.DB.prepare("UPDATE export_jobs SET downloaded_at = COALESCE(downloaded_at, ?), updated_at = ? WHERE id = ? AND user_id = ?").bind(now(), now(), job.id, user.id).run();
  return new Response(object.body, {
    headers: {
      "content-type": isArchive ? job.archive_content_type || "application/zip" : "application/json; charset=utf-8",
      "content-disposition": isArchive ? `attachment; filename="quietcollective-export-${job.id}.zip"` : `attachment; filename="quietcollective-export-${job.id}.json"`,
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

}
