import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerEntry = readFileSync("worker/src/index.ts", "utf8");
const workerRoutes = readFileSync("worker/src/routes.ts", "utf8");
const d1MetricsSource = readFileSync("worker/src/d1-metrics.ts", "utf8");
const feedbackCleanupSource = readFileSync("worker/src/feedback-cleanup.ts", "utf8");
const instanceCacheSource = readFileSync("worker/src/instance-cache.ts", "utf8");
const sessionsSource = readFileSync("worker/src/sessions.ts", "utf8");
const workerConstants = readFileSync("worker/src/constants.ts", "utf8");
const webPushSource = readFileSync("worker/src/web-push.ts", "utf8");
const tagIndexSource = readFileSync("worker/src/tag-index.ts", "utf8");
const worker = `${workerEntry}\n${workerRoutes}\n${workerConstants}\n${webPushSource}`;
const adminViewSource = readFileSync("web/src/views/admin.tsx", "utf8");
const accountPageSource = readFileSync("web/src/pages/account.ts", "utf8");
const accountViewSource = readFileSync("web/src/views/account.tsx", "utf8");
const authViewSource = readFileSync("web/src/views/auth.tsx", "utf8");
const authPageSource = readFileSync("web/src/pages/auth.ts", "utf8");
const commentsSource = readFileSync("web/src/app/comments.ts", "utf8");
const activitySource = readFileSync("worker/src/activity.ts", "utf8");
const homeViewSource = readFileSync("web/src/views/home.tsx", "utf8");
const apiCacheSource = readFileSync("worker/src/api-cache.ts", "utf8");
const mediaSource = readFileSync("worker/src/media.ts", "utf8");
const mediaComponentSource = readFileSync("web/src/components/media.ts", "utf8");
const reactionsSource = readFileSync("web/src/app/reactions.ts", "utf8");
const workPrefetchSource = readFileSync("web/src/app/work-prefetch.ts", "utf8");
const workTileSource = readFileSync("web/src/components/work-tile.tsx", "utf8");
const workViewSource = readFileSync("web/src/views/works.tsx", "utf8");
const utilsSource = readFileSync("worker/src/utils.ts", "utf8");
const stylesSource = readFileSync("public/styles.css", "utf8");
const appSource = [
  "web/src/main.ts",
  "web/src/app/core.ts",
  "web/src/app/state.ts",
  "web/src/lib/markdown.ts",
  "web/src/app/api.ts",
  "web/src/app/forms.ts",
  "web/src/app/shell.ts",
  "web/src/app/mentions.ts",
  "web/src/app/notifications.ts",
  "web/src/app/comments.ts",
  "web/src/app/interactions.ts",
  "web/src/pages/galleries.ts",
  "web/src/pages/home.ts",
  "web/src/pages/works.ts",
  "web/src/views/galleries.tsx",
  "web/src/views/islands.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const serviceWorker = readFileSync("public/sw.js", "utf8");
const wrangler = readFileSync("wrangler.jsonc", "utf8");
const developersPage = readFileSync("public/developers.html", "utf8");
const checks = [];

function test(name, fn) {
  checks.push({ name, fn });
}

function routeBlock(start, end) {
  return sourceBlock(worker, start, end);
}

function sourceBlock(source, start, end) {
  const sourceStartIndex = source.indexOf(start);
  assert.notEqual(sourceStartIndex, -1, `missing source start: ${start}`);
  const endIndex = end ? source.indexOf(end, sourceStartIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `missing source end: ${end}`);
  return source.slice(sourceStartIndex, endIndex);
}

test("protected API route groups require authentication", () => {
  for (const route of [
    "/api/admin/*",
    "/api/home",
    "/api/members",
    "/api/users/*",
    "/api/galleries",
    "/api/galleries/*",
    "/api/works/*",
    "/api/role-suggestions",
    "/api/reactions/*",
    "/api/markdown-assets",
    "/api/comments",
    "/api/comments/*",
    "/api/activity",
    "/api/tags/*",
    "/api/notifications",
    "/api/notifications/*",
    "/api/exports",
    "/api/exports/*",
    "/api/media/*",
  ]) {
    assert.match(worker, new RegExp(`app\\.use\\("${route.replaceAll("*", "\\*")}", requireUser\\)`));
  }
});

test("public setup route keeps bootstrap token and one-admin guard", () => {
  const block = routeBlock('app.post("/api/setup/admin"', 'app.post("/api/auth/login"');
  assert.match(block, /adminCount\(c\.env\.DB\)/);
  assert.match(block, /ADMIN_SETUP_TOKEN/);
  assert.match(block, /stringField\(body\.token\) !== c\.env\.ADMIN_SETUP_TOKEN/);
});

test("comment reads are permission checked and avoid ambiguous self-join columns", () => {
  const route = routeBlock('app.get("/api/comments"', 'app.post("/api/reactions/:targetType/:targetId/heart"');
  const helper = sourceBlock(workerRoutes, "async function commentsForTarget", 'app.get("/api/comments"');
  assert.match(route, /canViewTarget\(c\.env\.DB, currentUser\(c\), targetType, targetId\)/);
  assert.match(route, /commentsForTarget\(c, currentUser\(c\), targetType, targetId\)/);
  assert.match(helper, /WHERE comments\.target_type = \? AND comments\.target_id = \?/);
  assert.doesNotMatch(helper, /WHERE target_type = \? AND target_id = \?/);
  assert.match(helper, /COUNT\(reactions\.id\) AS heart_count/);
});

test("comment writes and reactions require view/comment capability before inserts", () => {
  const comments = routeBlock('app.post("/api/comments"', 'app.get("/api/comments"');
  assert.ok(comments.indexOf("canCommentTarget") < comments.indexOf("INSERT INTO comments"));
  assert.ok(comments.indexOf("canCommentTarget") < comments.indexOf("insertEvent"));

  const reactions = routeBlock('app.post("/api/reactions/:targetType/:targetId/heart"', 'app.delete("/api/reactions/:targetType/:targetId/heart"');
  assert.match(reactions, /targetType !== "gallery"/);
  assert.ok(reactions.indexOf("canViewTarget") < reactions.indexOf("INSERT OR IGNORE INTO reactions"));
  assert.ok(reactions.indexOf("canViewTarget") < reactions.indexOf("insertEvent"));
});

test("notifications use the joined activity context instead of the old N+1 formatter", () => {
  const block = sourceBlock(workerRoutes, "async function notificationsForUser", 'app.get("/api/notifications/poll"');
  assert.match(block, /visibleNotificationRows\(c, user, \{ limit: 200 \}\)/);
  assert.match(block, /async function visibleNotificationRows/);
  assert.match(block, /ACTIVITY_CONTEXT_SELECT/);
  assert.match(block, /joinedEventVisible/);
  assert.match(block, /activityEntryFromJoinedRow/);
  assert.doesNotMatch(block, /activityEntry\(c\.env/);
});

test("linked work collaborators are notified when added or updated", () => {
  const eventBlock = sourceBlock(workerEntry, "async function processEvent", 'if (event.type === "work.version_created")');
  assert.match(eventBlock, /event\.type === "work\.collaborator_added"/);
  assert.match(eventBlock, /event\.type === "work\.collaborator_updated"/);
  assert.match(eventBlock, /targets\.add\(userId\)/);
  assert.match(eventBlock, /You were added as a contributor/);

  const collaboratorBlock = routeBlock("async function createWorkCollaborator", 'app.post("/api/galleries/:galleryId/works"');
  assert.match(collaboratorBlock, /insertWorkCollaboratorEvent\(c, "work\.collaborator_added", workId, id, linkedUserId\)/);
  assert.match(collaboratorBlock, /insertWorkCollaboratorEvent\(c, "work\.collaborator_updated", workId, existingSameRole\.id, linkedUserId\)/);
  assert.match(workerRoutes, /if \(linkedUserId && linkedUserId === actorId\) return/);
});

test("work collaborators can credit the same linked user for multiple roles", () => {
  const createBlock = routeBlock("async function createWorkCollaborator", 'app.post("/api/galleries/:galleryId/works"');
  assert.match(createBlock, /lower\(role_label\) = lower\(\?\)/);
  assert.doesNotMatch(createBlock, /SELECT id FROM work_collaborators WHERE work_id = \? AND user_id = \?["`]/);
  assert.match(createBlock, /INSERT INTO work_collaborators/);
  assert.match(createBlock, /insertWorkCollaboratorEvent\(c, "work\.collaborator_added"/);

  const updateBlock = routeBlock('app.patch("/api/works/:id/collaborators/:collaboratorId"', 'app.delete("/api/works/:id/collaborators/:collaboratorId"');
  assert.match(updateBlock, /nextRoleLabel/);
  assert.match(updateBlock, /lower\(role_label\) = lower\(\?\) AND id <> \?/);
  assert.doesNotMatch(updateBlock, /That user is already credited on this work/);

  const workCaps = sourceBlock(workerEntry, "async function workCapabilities", "function galleryVisibilityRank");
  assert.match(workCaps, /COUNT\(\*\) AS row_count/);
  assert.match(workCaps, /MAX\(can_edit\) AS can_edit/);
  assert.match(workCaps, /row_count > 0/);

  const galleryBlock = routeBlock('app.get("/api/galleries/:id"', 'app.get("/api/galleries/:id/crosspost-candidates"');
  assert.match(galleryBlock, /SELECT work_id,[\s\S]*MAX\(can_edit\) AS can_edit[\s\S]*GROUP BY work_id/);
  assert.doesNotMatch(galleryBlock, /LEFT JOIN work_collaborators AS current_work_collaborator/);

  const migration = readFileSync("migrations/0017_work_collaborator_multi_role.sql", "utf8");
  assert.match(migration, /CREATE TABLE work_collaborators_v2/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(\s*work_id\s*,\s*user_id\s*\)/);
  assert.match(migration, /idx_work_collaborators_work_user/);
});

test("notification polling does not update member activity", () => {
  const block = sourceBlock(workerEntry, "function requestCountsAsActivity", "function currentUser");
  assert.match(block, /c\.req\.path !== "\/api\/notifications\/poll"/);
  assert.ok(block.indexOf("requestCountsAsActivity(c)") < block.indexOf("UPDATE users SET last_active_at"));
});

test("password login and work posting mark members active without broad mutation touches", () => {
  const login = routeBlock('app.post("/api/auth/login"', 'app.post("/api/auth/logout"');
  assert.match(login, /touchUserActivity\(c, user\.id\)/);
  assert.match(login, /user\.last_active_at = activeAt/);

  const workCreate = routeBlock('app.post("/api/galleries/:galleryId/works"', 'app.get("/api/works/:id"');
  assert.match(workCreate, /touchUserActivity\(c, user\.id, timestamp\)/);
  assert.match(workCreate, /touchUserActivity\(c, user\.id\)[\s\S]*duplicate: true/);

  const middleware = sourceBlock(workerRoutes, 'app.use("*", async (c, next) => {', 'app.get("/api/health"');
  assert.doesNotMatch(middleware, /touchUserActivity/);
});

test("session cookies carry minimal signed auth claims and revalidate user rows periodically", () => {
  assert.match(sessionsSource, /SESSION_CLAIMS_VERSION = 2/);
  assert.match(sessionsSource, /SESSION_REVALIDATE_AFTER_SECONDS = 10 \* 60/);
  assert.match(sessionsSource, /uid: user\.id/);
  assert.match(sessionsSource, /role: user\.role/);
  assert.match(sessionsSource, /pwd: user\.password_changed_at \|\| null/);
  assert.match(sessionsSource, /fpc: user\.force_password_change_at \|\| null/);
  assert.match(sessionsSource, /vat: options\.verifiedAt \|\| issuedAt/);
  assert.doesNotMatch(sessionsSource, /email|handle|bio|avatar_key|profile_image_key/);
  assert.match(sessionsSource, /parts\.length !== 4/);
  assert.match(sessionsSource, /kind: "legacy"/);

  const authBlock = sourceBlock(workerEntry, "async function requireUser", "function currentUser");
  assert.match(authBlock, /readSession\(token, c\.env\)/);
  assert.match(authBlock, /const cookie = parseCookies\(c\.req\.header\("cookie"\)\)\.get\("qc_session"\)/);
  assert.match(authBlock, /const token = cookie \|\| bearer/);
  assert.match(authBlock, /session\.kind === "legacy" \|\| session\.stale/);
  assert.match(authBlock, /getSessionUserById\(c\.env\.DB, userId\)/);
  assert.match(authBlock, /createSession\(user, c\.env, \{ expiresAt: session\.expiresAt \}\)/);
  assert.match(authBlock, /sessionCookie\(refreshedToken, session\.expiresAt\)/);
  assert.match(authBlock, /userFromSessionClaims\(session\.claims\)/);
  assert.doesNotMatch(authBlock, /getUserById\(c\.env\.DB, userId\)/);

  const sessionQuery = sourceBlock(workerEntry, "async function getSessionUserById", "async function getUserByHandle");
  assert.match(sessionQuery, /SELECT id, role, disabled_at, password_changed_at, force_password_change_at, last_active_at/);
  assert.doesNotMatch(sessionQuery, /SELECT \*/);

  const authMe = routeBlock('app.get("/api/auth/me"', 'app.patch("/api/auth/password"');
  assert.match(authMe, /fullCurrentUser\(c\)/);

  const galleries = routeBlock('app.get("/api/galleries"', 'app.post("/api/galleries/:id/pin"');
  assert.doesNotMatch(galleries, /fullCurrentUser|getUserById/);
});

test("activity and mention notifications stay scoped to visible content", () => {
  const joinedVisibility = sourceBlock(activitySource, "export function joinedEventVisible", "function fallbackThumbnailUrl");
  assert.match(joinedVisibility, /row\.type === "rules\.published" \|\| row\.type === "rules\.accepted"\) return false/);
  assert.match(joinedVisibility, /selfTargetedContributorEvent\(user, row\)/);
  assert.match(joinedVisibility, /row\.subject_type === "user"\) return row\.type === "user\.joined"/);
  assert.doesNotMatch(joinedVisibility, /row\.subject_type === "user" \|\| row\.subject_type === "profile"/);

  const eventBlock = sourceBlock(workerEntry, "async function processEvent", "async function galleryAccessUsers");
  assert.match(workerEntry, /async function canUserViewTarget/);
  assert.match(eventBlock, /canUserViewTarget\(env\.DB, row\.id, event\.target_type, event\.target_id\)/);
  assert.doesNotMatch(eventBlock, /for \(const row of mentioned\.results\) targets\.add\(row\.id\)/);

  const activityRoute = sourceBlock(workerRoutes, "async function activityEventsForUser", 'app.get("/api/activity"');
  assert.match(activityRoute, /type NOT IN \('rules\.published', 'rules\.accepted'\)/);
});

test("private media stays permission-gated and signed media uses direct R2 URLs when configured", () => {
  const signed = routeBlock('app.get("/api/media/signed/:token"', 'app.use("/api/admin/*"');
  assert.match(signed, /readSignedMediaPayload\(c\.env, c\.req\.param\("token"\)\)/);
  assert.match(signed, /if \(!payload\) return c\.json\(\{ error: "Forbidden" \}, 403\)/);
  assert.ok(worker.indexOf('app.get("/api/media/signed/:token"') < worker.indexOf('app.use("/api/media/*", requireUser)'));

  const mediaUrl = sourceBlock(mediaSource, "export async function r2PresignedGetUrl", "export async function signedAppMediaUrl");
  assert.match(mediaUrl, /R2_ACCOUNT_ID/);
  assert.match(mediaUrl, /R2_ACCESS_KEY_ID/);
  assert.match(mediaUrl, /R2_SECRET_ACCESS_KEY/);
  assert.match(mediaUrl, /R2_BUCKET_NAME/);
  assert.match(mediaSource, /AWS4-HMAC-SHA256/);
  assert.match(mediaUrl, /UNSIGNED-PAYLOAD/);
  assert.match(mediaUrl, /X-Amz-Expires/);
  assert.match(mediaSource, /r2\.cloudflarestorage\.com/);

  const mediaDispatch = sourceBlock(mediaSource, "export async function signedMediaUrl", "export async function readSignedMediaPayload");
  assert.match(mediaDispatch, /r2PresignedGetUrl\(env, key, contentType, variant, filename\)/);
  assert.match(mediaDispatch, /signedAppMediaUrl\(env, key, contentType, variant, filename\)/);

  assert.match(workerRoutes, /async function directR2MediaRedirect/);
  assert.match(workerRoutes, /c\.redirect\(url, 302\)/);
  const signedRoute = routeBlock('app.get("/api/media/signed/:token"', 'app.use("/api/admin/*"');
  assert.match(signedRoute, /directR2MediaRedirect\(c, payload\.key, payload\.content_type, payload\.variant, payload\.filename\)/);
  const routedWorkMedia = routeBlock('app.get("/api/media/works/:workId/versions/:versionId/:variant"', 'app.all("/api/*"');
  assert.ok(routedWorkMedia.indexOf("assertWorkCapability") < routedWorkMedia.indexOf("directR2MediaRedirect"));
  const routedMarkdownMedia = routeBlock('app.get("/api/media/markdown-assets/:id/:variant"', 'app.get("/api/media/works/:workId/versions/:versionId/:variant"');
  assert.ok(routedMarkdownMedia.indexOf("canViewTarget") < routedMarkdownMedia.indexOf("directR2MediaRedirect"));

  const markdownUpload = routeBlock('app.post("/api/markdown-assets"', 'app.get("/api/galleries"');
  assert.match(markdownUpload, /const key = `\$\{base\}\/original`/);
  assert.match(markdownUpload, /const previewKey = `\$\{base\}\/preview`/);
  assert.match(markdownUpload, /const thumbnailKey = `\$\{base\}\/thumbnail`/);
  assert.match(markdownUpload, /`asset-\$\{id\}`/);
  assert.doesNotMatch(markdownUpload, /original-\$\{file\.name|preview-\$\{previewFile\.name|thumbnail-\$\{thumbnailFile\.name/);
  const workVersionUpload = sourceBlock(workerRoutes, "async function createWorkVersion", "function collaboratorInputsFromBody");
  assert.match(workVersionUpload, /originalKey = `\$\{base\}\/original`/);
  assert.match(workVersionUpload, /previewKey = `\$\{base\}\/preview`/);
  assert.match(workVersionUpload, /thumbnailKey = `\$\{base\}\/thumbnail`/);
  assert.match(workVersionUpload, /originalFilename = `work-\$\{work\.id\}-version-\$\{id\}`/);
  assert.doesNotMatch(workVersionUpload, /original-\$\{file\.name|preview-\$\{previewFile\.name|thumbnail-\$\{thumbnailFile\.name/);

  const media = sourceBlock(mediaSource, "export async function readSignedMediaPayload", undefined);
  assert.match(media, /sign\(data, secret\) !== signature/);

  const cacheControl = sourceBlock(utilsSource, "export function cacheControl", undefined);
  assert.match(cacheControl, /variant === "original"[\s\S]*"private, no-store"/);
});

test("cacheable gallery and feed APIs use ETags before expensive reads", () => {
  const helpers = sourceBlock(apiCacheSource, "export const API_CACHE_TOKEN_KEY", undefined);
  assert.match(helpers, /prepareApiCache/);
  assert.match(helpers, /apiNotModified/);
  assert.match(helpers, /bumpApiCacheToken/);
  assert.match(helpers, /await sign\(unsigned, secret\)/);
  assert.ok(helpers.includes('replace(/^W\\//i, "")'));
  assert.match(workerEntry, /readCachedApiCacheToken\(c\.env\)/);
  assert.match(instanceCacheSource, /API_CACHE_TOKEN_STORAGE_KEY = "api-cache-token:v1"/);
  assert.match(instanceCacheSource, /readApiCacheTokenFromD1\(this\.env\.DB\)/);

  const middleware = routeBlock('app.use("*", async (c, next) => {', 'app.get("/api/health"');
  assert.match(middleware, /mutatingApiRequest\(c\)/);
  assert.match(middleware, /bumpCachedApiCacheToken\(c\.env\)/);
  assert.match(middleware, /!c\.res\.headers\.has\("Cache-Control"\)/);

  const authMe = routeBlock('app.get("/api/auth/me"', 'app.patch("/api/auth/password"');
  assert.ok(authMe.indexOf("prepareApiCache") < authMe.indexOf("fullCurrentUser"));
  assert.match(authMe, /apiNotModified\(cache\)/);
  assert.match(authMe, /cacheableJson\(c, cache, \{/);

  const home = routeBlock('app.get("/api/home"', 'app.patch("/api/auth/password"');
  assert.match(home, /app\.get\("\/api\/home", requireUser/);
  assert.ok(home.indexOf("prepareApiCache") < home.indexOf("fullCurrentUser"));
  assert.match(home, /apiNotModified\(cache\)/);
  assert.match(home, /visibleGalleries\(c, user\)/);
  assert.match(home, /visibleMembers\(c\)/);
  assert.match(home, /popularTagsForUser\(c, user\)/);
  assert.match(home, /activityEventsForUser\(c, user\)/);
  assert.match(home, /notificationsForUser\(c, user\)/);
  assert.match(home, /homeRecentWorks\(c, user\)/);
  assert.match(home, /cacheableJson\(c, cache, \{/);

  const visibleMembersHelper = sourceBlock(workerRoutes, "async function visibleMembers", "async function visibleGalleries");
  assert.match(visibleMembersHelper, /SELECT \* FROM users WHERE disabled_at IS NULL/);
  assert.match(visibleMembersHelper, /SELECT user_id, tag FROM medium_tags/);
  const members = routeBlock('app.get("/api/members"', 'app.get("/api/users/:handle"');
  assert.ok(members.indexOf("prepareApiCache") < members.indexOf("visibleMembers"));
  assert.match(members, /apiNotModified\(cache\)/);
  assert.match(members, /cacheableJson\(c, cache, \{ members:/);

  const userProfile = routeBlock('app.get("/api/users/:handle"', 'app.patch("/api/users/me"');
  assert.ok(userProfile.indexOf("prepareApiCache") < userProfile.indexOf("SELECT * FROM users WHERE handle = ?"));
  assert.match(userProfile, /apiNotModified\(cache\)/);
  assert.match(userProfile, /cacheableJson\(c, cache, \{ user:/);

  const visibleGalleriesHelper = sourceBlock(workerRoutes, "async function visibleGalleries", "const HOME_WORK_GALLERY_CAPS");
  assert.match(visibleGalleriesHelper, /SELECT \* FROM galleries ORDER BY updated_at DESC/);
  assert.match(visibleGalleriesHelper, /serializeGallery/);
  const galleries = routeBlock('app.get("/api/galleries"', 'app.post("/api/galleries/:id/pin"');
  assert.ok(galleries.indexOf("prepareApiCache") < galleries.indexOf("visibleGalleries"));
  assert.match(galleries, /apiNotModified\(cache\)/);
  assert.match(galleries, /cacheableJson\(c, cache, \{ galleries:/);

  const gallery = routeBlock('app.get("/api/galleries/:id"', 'app.get("/api/galleries/:id/crosspost-candidates"');
  assert.ok(gallery.indexOf("prepareApiCache") < gallery.indexOf("SELECT * FROM galleries WHERE id = ?"));
  assert.ok(gallery.indexOf("apiNotModified(cache)") < gallery.indexOf("assertGalleryCapability"));
  assert.match(gallery, /includeComments/);
  assert.match(gallery, /`gallery:\$\{c\.req\.param\("id"\)\}:comments`/);
  assert.match(gallery, /commentsForTarget\(c, user, "gallery", gallery\.id\)/);
  assert.match(gallery, /apiNotModified\(cache\)/);
  assert.match(gallery, /cacheableJson\(c, cache,/);

  const comments = routeBlock('app.get("/api/comments"', 'app.post("/api/reactions/:targetType/:targetId/heart"');
  assert.ok(comments.indexOf("prepareApiCache") < comments.indexOf("commentsForTarget"));
  assert.match(comments, /cacheableJson\(c, cache, \{ comments: await commentsForTarget/);

  const workComments = routeBlock('app.get("/api/works/:id/comments"', 'app.patch("/api/works/:id"');
  assert.ok(workComments.indexOf("prepareApiCache") < workComments.indexOf("SELECT comments.*, users.display_name"));
  assert.match(workComments, /apiNotModified\(cache\)/);
  assert.match(workComments, /cacheableJson\(c, cache, \{ comments \}\)/);

  const activity = routeBlock('app.get("/api/activity"', 'app.get("/api/notifications"');
  assert.match(activity, /prepareApiCache/);
  assert.match(activity, /apiNotModified\(cache\)/);
  assert.match(activity, /cacheableJson\(c, cache, \{ events:/);

  const notifications = routeBlock('app.get("/api/notifications"', 'app.get("/api/notifications/poll"');
  assert.match(notifications, /prepareApiCache/);
  assert.match(notifications, /apiNotModified\(cache\)/);
  assert.match(notifications, /cacheableJson\(c, cache, \{ notifications:/);

  const clientCache = appSource.slice(appSource.indexOf("function isCacheableApiRequest"), appSource.indexOf("async function api"));
  assert.match(clientCache, /API_JSON_CACHEABLE_PATHS/);
  assert.ok(appSource.includes('/^\\/api\\/home$/'));
  assert.ok(appSource.includes('/^\\/api\\/auth\\/me$/'));
  assert.ok(appSource.includes('/^\\/api\\/members$/'));
  assert.ok(appSource.includes('/^\\/api\\/users\\/[^/?]+$/'));
  assert.ok(appSource.includes('/^\\/api\\/users\\/[^/?]+\\/works$/'));
  assert.ok(appSource.includes('include=comments'));
  assert.ok(appSource.includes('/^\\/api\\/works\\/[^/?]+\\/comments$/'));
  assert.doesNotMatch(clientCache, /state\.me/);

  const homePage = sourceBlock(appSource, "async function renderHome", "async function renderGalleries");
  assert.match(homePage, /api\("\/api\/home"\)/);
  assert.doesNotMatch(homePage, /api\("\/api\/activity"|api\("\/api\/notifications"|api\(`\/api\/galleries\/\$\{gallery\.id\}`\)/);

  const galleryPage = sourceBlock(appSource, "async function renderGallery", "function bindCreateWork");
  assert.match(galleryPage, /api\(`\/api\/galleries\/\$\{encodePath\(id\)\}\?include=comments`\)/);
  assert.doesNotMatch(galleryPage, /api\(`\/api\/comments\?target_type=gallery/);
  assert.match(galleryPage, /comments: data\.comments \|\| \[\]/);

  const tagDetail = routeBlock('app.get("/api/tags/:tag"', 'app.patch("/api/comments/:id"');
  assert.ok(tagDetail.indexOf("prepareApiCache") < tagDetail.indexOf("tagDetailForUser"));
  assert.match(tagDetail, /apiNotModified\(cache\)/);
  assert.match(tagDetail, /cacheableJson\(c, cache, data\)/);
  assert.match(tagDetail, /FROM tag_index/);
  assert.match(tagDetail, /tagIndexReady\(c\.env\.DB\)/);
  assert.match(tagDetail, /legacyTagDetailForUser/);
  assert.match(tagIndexSource, /export async function rebuildTagIndex/);
  assert.ok(appSource.includes('/^\\/api\\/tags\\/[^/?]+$/'));
});

test("profiles use structured links and expose recent visible credited work", () => {
  const memberWorks = routeBlock('app.get("/api/users/:handle/works"', "function normalizedProfileLinks");
  assert.match(memberWorks, /work_collaborators\.user_id/);
  assert.match(memberWorks, /works\.created_by = \? OR work_collaborators\.user_id IS NOT NULL/);
  assert.ok(memberWorks.indexOf("canViewTarget") < memberWorks.indexOf("serializeWork"));
  assert.match(memberWorks, /cacheableJson\(c, cache, \{ works \}\)/);

  assert.match(accountViewSource, /data-profile-link-row/);
  assert.match(accountViewSource, /name="link_site"/);
  assert.match(accountViewSource, /name="link_url"/);
  assert.doesNotMatch(accountViewSource, /Links JSON|Medium Tags|tag-form/);
  assert.match(accountPageSource, /function profileLinks/);
  assert.match(accountPageSource, /data-add-profile-link/);
  assert.doesNotMatch(accountPageSource, /medium-tags|loadPopularTags|tag-form/);
  assert.match(workerRoutes, /function normalizedProfileLinks/);
  assert.match(workerRoutes, /site: site \|\| url\.hostname/);

  assert.doesNotMatch(homeViewSource, /<p class="eyebrow">Recently Updated<\/p>/);
  assert.match(homeViewSource, /Panel title="Recent Work"/);
  assert.match(homeViewSource, /<WorkGrid works=\{works\}/);
  assert.match(appSource, /api\(`\/api\/users\/\$\{encodePath\(handle\)\}\/works`\)/);
  assert.match(commentsSource, /Add Gallery Comment/);
});

test("browser notification polling is etagged and throttled", () => {
  const block = routeBlock('app.get("/api/notifications/poll"', 'app.post("/api/notifications/:id/read"');
  assert.match(worker, /BROWSER_NOTIFICATION_RECENT_POLL_INTERVAL_MS = 60 \* 1000/);
  assert.match(worker, /BROWSER_NOTIFICATION_RECENT_WINDOW_MS = 30 \* 60 \* 1000/);
  assert.match(worker, /BROWSER_NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(worker, /BROWSER_NOTIFICATION_FOLLOWUP_WINDOW_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(block, /visibleNotificationRows\(c, user, \{ unreadOnly: true, limit: 1000 \}\)/);
  assert.match(block, /unreadCount = visibleUnreadRows\.length/);
  assert.match(block, /latestCreatedAt = visibleUnreadRows\[0\]\?\.notification_created_at/);
  assert.doesNotMatch(block, /SELECT COUNT\(\*\) AS unread_count/);
  assert.doesNotMatch(block, /sanitizeEtagPart\(since \|\| "all"\)/);
  assert.match(block, /etagMatches\(c\.req\.header\("if-none-match"\), etag\)/);
  assert.ok(block.indexOf("apiNotModified(cache)") < block.indexOf("activityEntryFromJoinedRow"));
  assert.match(workerRoutes, /ACTIVITY_CONTEXT_SELECT/);
  assert.match(block, /activityEntryFromJoinedRow/);
  assert.match(block, /action_url: row\.notification_action_url \|\| activity\?\.href \|\| "\/"/);
  assert.match(block, /X-Recent-Poll-Interval-Ms/);
  assert.match(block, /X-Followup-Poll-Interval-Ms/);
  assert.match(block, /unread_count: unreadCount/);
  assert.match(block, /latest_created_at: latestCreatedAt/);

  assert.match(appSource, /NOTIFICATION_RECENT_POLL_INTERVAL_MS = 60 \* 1000/);
  assert.match(appSource, /NOTIFICATION_RECENT_WINDOW_MS = 30 \* 60 \* 1000/);
  assert.match(appSource, /NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(appSource, /NOTIFICATION_FOLLOWUP_WINDOW_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(appSource, /periodicSync\.register\("qc-notifications"/);
  assert.match(appSource, /browserPushSubscriptionActive\) return NOTIFICATION_IDLE_POLL_INTERVAL_MS/);
  assert.match(appSource, /pushSubscribed \? NOTIFICATION_IDLE_POLL_INTERVAL_MS : NOTIFICATION_RECENT_POLL_INTERVAL_MS/);
  assert.match(appSource, /NOTIFICATION_TITLE_PREFIX/);
  assert.match(appSource, /document\.title = Number\(state\.unreadNotifications \|\| 0\) > 0/);
  assert.match(appSource, /id="comment-\$\{commentId\}"/);
  assert.match(appSource, /id="heart-\$\{escapeHtml\(heartId\)\}"/);
  assert.match(appSource, /function highlightLinkedComment/);
  assert.match(appSource, /location\.hash\.startsWith\("#heart-"\)/);
  assert.match(appSource, /scrollIntoView\(\{ block: "center"/);
  assert.match(activitySource, /\/works\/\$\{row\.target_work_id\}#comment-\$\{encodeURIComponent\(row\.subject_id\)\}/);
  assert.match(activitySource, /\/galleries\/\$\{row\.target_id\}#comment-\$\{encodeURIComponent\(row\.subject_id\)\}/);
  assert.match(activitySource, /#heart-work-\$\{encodeURIComponent\(row\.target_work_id\)\}/);
  assert.match(activitySource, /#heart-gallery-\$\{encodeURIComponent\(row\.target_id\)\}/);
  assert.match(appSource, /targetType === "gallery" \? "Comments on Gallery" : "Comments"/);
  assert.match(appSource, /highlightLinkedComment\(\)/);
  assert.match(serviceWorker, /headers\.set\("if-none-match", state\.etag\)/);
  assert.match(serviceWorker, /function notificationPollIntervalMs/);
  assert.match(serviceWorker, /state\.pushSubscribed\) return idleInterval/);
  assert.match(serviceWorker, /elapsed <= recentWindow/);
  assert.match(serviceWorker, /elapsed <= recentWindow \+ followupWindow/);
  assert.match(serviceWorker, /notificationsChanged \? timestamp : state\.lastUsedAt/);
  assert.doesNotMatch(serviceWorker, /Number\(data\.unread_count \|\| 0\) > 0/);
});

test("browser notifications register web push subscriptions and use VAPID directly", () => {
  assert.match(workerRoutes, /app\.get\("\/api\/notifications\/push-public-key"/);
  assert.match(workerRoutes, /app\.post\("\/api\/notifications\/push-subscriptions"/);
  assert.match(workerRoutes, /app\.delete\("\/api\/notifications\/push-subscriptions"/);
  assert.match(workerEntry, /sendBrowserPushNotifications\(env, userId\)/);
  assert.match(workerEntry, /FROM push_subscriptions/);
  assert.match(webPushSource, /crypto\.subtle\.importKey/);
  assert.match(webPushSource, /crypto\.subtle\.sign/);
  assert.match(webPushSource, /Authorization: `vapid t=\$\{jwt\}, k=\$\{vapidPublicKey\}`/);
  assert.match(webPushSource, /Urgency: "high"/);
  assert.doesNotMatch(webPushSource, /from "web-push"/);
  assert.match(wrangler, /"max_batch_timeout": 2/);
  assert.match(appSource, /pushManager\.subscribe/);
  assert.match(appSource, /\/api\/notifications\/push-subscriptions/);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /pollNotifications\(\{ force: true \}\)/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /data: \{ notificationId: item\.id, url: item\.action_url \|\| "\/" \}/);
  assert.match(serviceWorker, /\/api\/notifications\/\$\{encodeURIComponent\(notificationId\)\}\/read/);
  assert.match(serviceWorker, /pollNotifications\(\{ force: true, suppressExisting: true \}\)/);
  assert.match(serviceWorker, /client\.navigate\(targetUrl\.href\)\.catch\(\(\) => null\)/);
  assert.match(serviceWorker, /self\.clients\.openWindow\(targetUrl\.href\)/);
});

test("markdown editor preview can be toggled off", () => {
  assert.match(appSource, /name: "preview"[\s\S]*EasyMDE\.togglePreview[\s\S]*noDisable: true/);
  assert.match(appSource, /previewRender: \(plainText\) => renderMarkdown\(plainText\)/);
  assert.match(appSource, /markdownAssetVariantUrl\(url, "thumbnail"\)/);
  assert.match(appSource, /function insertMarkdownImage/);
  assert.match(appSource, /cm\.setCursor\(cm\.posFromIndex\(startIndex \+ markdown\.length\)\)/);
  assert.match(appSource, /api\("\/api\/tags\/popular"\)/);
  assert.match(appSource, /function filteredTags/);
  const tagSuggestions = sourceBlock(appSource, "async function ensurePopularTags", "function completionToken");
  assert.match(tagSuggestions, /tagSuggestionsLoaded/);
  assert.doesNotMatch(tagSuggestions, /if \(state\.popularTagsLoaded\) return/);
  const completion = sourceBlock(appSource, "function completionToken", "function filteredMembers");
  assert.ok(completion.includes("#([^\\s#]+)$"));
  assert.match(appSource, /completionToken\(cm\.getLine\(cursor\.line\), cursor\.ch, \{ tags: true \}\)/);
  assert.match(appSource, /cm\.on\("inputRead", scheduleUpdate\)/);
  assert.match(appSource, /cm\.on\("changes", scheduleUpdate\)/);
  assert.match(appSource, /activeContext\.kind === "tag" \? "No tags found" : "No members found"/);
  assert.match(stylesSource, /\.EasyMDEContainer \.CodeMirror \.cm-header/);
  assert.match(appSource, /editor\.codemirror\.refresh\(\)/);
});

test("protected media opens a swipeable gallery lightbox", () => {
  assert.match(mediaComponentSource, /function openMediaLightbox/);
  assert.match(mediaComponentSource, /data-lightbox-item/);
  assert.match(mediaComponentSource, /parsedLightboxItems/);
  assert.match(mediaComponentSource, /dataset\.lightboxGallery/);
  assert.match(mediaComponentSource, /target\?\.closest\("\[data-media-protect\], \[data-protected-image\]"\)/);
  assert.match(mediaComponentSource, /event\.preventDefault\(\)/);
  assert.match(mediaComponentSource, /event\.stopPropagation\(\)/);
  assert.match(mediaComponentSource, /pointerdown/);
  assert.match(mediaComponentSource, /pointermove/);
  assert.match(mediaComponentSource, /pointerup/);
  assert.match(mediaComponentSource, /setTrackOffset\(dragOffset, false\)/);
  assert.match(mediaComponentSource, /ArrowLeft/);
  assert.match(mediaComponentSource, /ArrowRight/);
  assert.match(mediaComponentSource, /const closeToActiveWork = \(\) =>/);
  assert.match(mediaComponentSource, /navigate\(href\)/);
  assert.match(mediaComponentSource, /requestAnimationFrame\(\(\) => navigate\(href\)\)/);
  assert.match(mediaComponentSource, /primeWorkPayloadPreview\(preview\)/);
  assert.match(mediaComponentSource, /contextmenu/);
  assert.match(mediaComponentSource, /data-protected-image/);
  assert.ok(mediaComponentSource.includes('overlay.querySelector("[data-lightbox-close]")?.addEventListener("click", closeToActiveWork);'));
  assert.doesNotMatch(mediaComponentSource, /Open work|data-lightbox-open-work/);
  assert.match(mediaComponentSource, /function bindDoubleTapHearts/);
  assert.match(mediaComponentSource, /DOUBLE_TAP_DELAY_MS/);
  assert.match(mediaComponentSource, /heartTarget\(targetType, targetId, element, event\)/);
  assert.match(mediaComponentSource, /warmWorkRoute\(item\.targetId\)/);
  assert.match(reactionsSource, /method: "POST"/);
  assert.match(reactionsSource, /doubletap-heart-burst/);
  assert.match(reactionsSource, /function heartBurstMarkup/);
  assert.match(reactionsSource, /doubletap-heart-ring is-one/);
  assert.match(reactionsSource, /doubletap-heart-ring is-two/);
  assert.match(reactionsSource, /doubletap-heart-core/);
  assert.match(reactionsSource, /function burstCenter/);
  assert.match(reactionsSource, /querySelector\?\.\("\[data-lightbox-current-image\]"\)[\s\S]*querySelector\?\.\("img\[data-protected-image\]"\)/);
  assert.match(reactionsSource, /updatePrefetchedWorkReactions\(targetId/);
  assert.match(workPrefetchSource, /function warmWorkRoute/);
  assert.match(workPrefetchSource, /primeWorkPayloadPreview/);
  assert.match(workPrefetchSource, /loadFreshWorkPayload/);
  assert.match(workPrefetchSource, /cachedWorkComments/);
  assert.match(workPrefetchSource, /loadWorkPayload/);
  assert.match(workPrefetchSource, /loadWorkComments/);
  assert.match(workTileSource, /data-doubletap-heart-type="work"/);
  assert.match(workTileSource, /data-doubletap-heart-id=\{work\.id\}/);
  assert.match(workTileSource, /\?tag=\$\{encodePath\(tag\)\}/);
  assert.match(workTileSource, /\?profile=\$\{encodePath\(profileHandle\)\}/);
  assert.doesNotMatch(workTileSource, /data-lightbox-item|data-lightbox-src|data-lightbox-gallery/);
  assert.match(workViewSource, /data-lightbox-item="true"/);
  assert.match(workViewSource, /data-doubletap-heart-type="work"/);
  assert.match(workViewSource, /data-lightbox-target-type="work"/);
  assert.match(workViewSource, /targetType: "work"/);
  assert.match(workViewSource, /data-lightbox-items=\{JSON\.stringify\(lightboxItems\)\}/);
  assert.match(workViewSource, /lightboxContext\?\.type === "tag"/);
  assert.match(workViewSource, /lightboxContext\?\.type === "profile"/);
  assert.match(workViewSource, /mergeCreditRole\(credits\[index\], collab\?\.role_label \|\| "contributor"\)/);
  assert.match(workViewSource, /<WorkCreditChips work=\{work\} collaborators=\{collaborators \|\| \[\]\} \/>[\s\S]*<GalleryAccessChips gallery=\{gallery\} className="is-inline" kinds=\{\["view"\]\} \/>/);
  assert.match(workViewSource, /version\.thumbnail_url \|\| version\.preview_url/);
  assert.match(workViewSource, /class="version-thumb"/);
  assert.match(appSource, /function workListContextFromLocation/);
  assert.match(appSource, /api\(`\/api\/tags\/\$\{encodePath\(context\.value\)\}`\)/);
  assert.match(appSource, /api\(`\/api\/users\/\$\{encodePath\(context\.value\)\}\/works`\)/);
  assert.match(appSource, /lightboxWorks: contextWorks\.length \? contextWorks : \[work\]/);
  assert.match(appSource, /lightboxContext,/);
  assert.match(homeViewSource, /<WorkGrid works=\{works\} profileHandle=\{user\.handle\}/);
  assert.match(homeViewSource, /<WorkGrid works=\{data\.works\} tag=\{data\.tag\}/);
  assert.match(appSource, /loadWorkPayload\(id\)/);
  assert.match(appSource, /renderWorkPage\(id, data, comments, \[\]\)/);
  assert.match(appSource, /hydrateWorkPage\(serial, id, data\)/);
  assert.match(appSource, /loadWorkComments\(id\)/);
  assert.match(stylesSource, /media-lightbox-backdrop/);
  assert.match(stylesSource, /media-lightbox-track/);
  assert.match(stylesSource, /media-lightbox-nav/);
  assert.match(stylesSource, /clip-path: inset\(0 1px\)/);
  assert.match(stylesSource, /contain: paint/);
  const lightboxImageCss = sourceBlock(stylesSource, ".media-lightbox-image {", ".media-lightbox-caption {");
  assert.match(lightboxImageCss, /border: 0/);
  assert.doesNotMatch(lightboxImageCss, /border: 1px/);
  assert.match(stylesSource, /doubletap-heart-burst/);
  assert.match(stylesSource, /doubletap-heart-ring/);
  assert.match(stylesSource, /doubletap-heart-core/);
  assert.match(stylesSource, /@keyframes doubletap-heart-ring/);
  assert.match(stylesSource, /cursor: zoom-in/);
});

test("work detail avoids full gallery reserialization", () => {
  const route = routeBlock('app.get("/api/works/:id"', 'app.get("/api/works/:id/comments"');
  assert.match(route, /assertWorkCapability\(c, c\.req\.param\("id"\), "view"\)/);
  assert.match(route, /const currentVersion = versions\.results\.find/);
  assert.match(route, /serializeWork\(c\.env, currentUser\(c\), gate\.work!, \{ capabilityResult: gate, currentVersion, leanGalleries: true \}\)/);

  const serializer = sourceBlock(workerEntry, "type WorkCapabilityResult", "async function serializeVersion");
  assert.match(serializer, /leanWorkGallery/);
  assert.match(serializer, /options\.capabilityResult \|\| await workCapabilities/);
  assert.match(serializer, /options\.capabilityResult\?\.galleries/);
  assert.match(serializer, /options\.leanGalleries && options\.capabilityResult\?\.galleryCaps/);
});

test("work detail lazily loads contributor role suggestions", () => {
  const workPage = readFileSync("web/src/pages/works.ts", "utf8");
  const hydrate = sourceBlock(workPage, "async function hydrateWorkPage", "async function renderWorkEdit");
  assert.doesNotMatch(hydrate, /loadRoleSuggestions/);
  assert.match(hydrate, /const supportPromise = needsSupportData \? loadGalleries\(\) : Promise\.resolve\(\)/);

  const collaborators = sourceBlock(workPage, "function bindCollaboratorManagement", "function bindRemoveCollaborator");
  assert.match(collaborators, /const ensureRoleDatalist = async \(\) =>/);
  assert.match(collaborators, /await loadRoleSuggestions\(\)/);
  assert.match(collaborators, /roleDatalist\("detail-work-role-options"\)/);
  assert.match(collaborators, /addButton\?\.addEventListener\("click", async/);
  assert.match(collaborators, /control\.addEventListener\("click", async/);
});

test("gallery comments and gallery reactions produce targetable notifications", () => {
  const eventBlock = sourceBlock(workerEntry, "async function processEvent", "async function galleryAccessUsers");
  assert.match(eventBlock, /event\.type === "comment\.created" && event\.target_type === "gallery"/);
  assert.match(eventBlock, /New comment on gallery/);
  assert.match(eventBlock, /targetType === "gallery"/);
  assert.match(eventBlock, /Someone liked your gallery/);
  assert.match(workerEntry, /reactionSummary\(env\.DB, user, "gallery", gallery\.id\)/);
  assert.match(workerEntry, /targetType: "work" \| "comment" \| "gallery"/);
  assert.match(workerRoutes, /targetType !== "work" && targetType !== "comment" && targetType !== "gallery"/);
  assert.match(readFileSync("migrations/0015_gallery_reactions.sql", "utf8"), /'work', 'comment', 'gallery'/);
  assert.match(appSource, /reactionButton\("gallery", id, gallery\.reactions\)/);
});

test("gallery posting is limited to eligible target galleries", () => {
  const createWork = routeBlock('app.post("/api/galleries/:galleryId/works"', 'app.get("/api/works/:id"');
  assert.match(createWork, /assertGalleryCapability\(c, galleryId, "upload_work"\)/);

  const galleryCaps = sourceBlock(workerEntry, "async function galleryCapabilities", "async function getWork");
  assert.match(galleryCaps, /resolveGalleryCapabilities\(\{ baseCaps, gallery, member \}\)/);
  assert.match(galleryCaps, /gallery\.visibility === "server_public"/);
  assert.doesNotMatch(galleryCaps, /ownership_type === "self"/);
  assert.doesNotMatch(galleryCaps, /admin/);
  assert.doesNotMatch(galleryCaps, /user\.role === "admin"\) return OWNER_CAPABILITIES/);
  assert.match(workerEntry, /galleryServerVisible/);
  assert.match(workerEntry, /gallery\.visibility === "server_public"/);
  assert.doesNotMatch(workerEntry, /gallery\.visibility === "server_public" && gallery\.ownership_type !== "self"/);
  assert.match(activitySource, /galleries\.visibility = 'server_public'/);
  assert.doesNotMatch(activitySource, /galleries\.visibility = 'server_public' AND galleries\.ownership_type != 'self'/);
  assert.match(workerRoutes, /\$\{alias\}\.visibility = 'server_public'/);
  assert.doesNotMatch(workerRoutes, /ownership === "self" \? "private"/);
  assert.doesNotMatch(appSource, /everyoneOption\.disabled = ownershipValue === "self"/);
  assert.match(appSource, /Everyone can view and comment, but only you can add images/);

  const candidates = routeBlock('app.get("/api/galleries/:id/crosspost-candidates"', 'app.patch("/api/galleries/:id"');
  assert.match(candidates, /assertGalleryCrosspostTarget\(c, galleryId\)/);
  assert.match(candidates, /works\.created_by = \?/);
  assert.match(candidates, /work_collaborators\.user_id = \?/);
  assert.match(candidates, /NOT EXISTS \(\s*SELECT 1 FROM work_galleries/);
  assert.match(candidates, /increases_visibility: increasesVisibility/);

  const crosspost = routeBlock('app.post("/api/works/:id/galleries"', 'app.delete("/api/works/:id/galleries/:galleryId"');
  assert.match(crosspost, /assertWorkCrosspostCapability\(c, c\.req\.param\("id"\)\)/);
  assert.doesNotMatch(crosspost, /assertWorkCapability\(c, c\.req\.param\("id"\), "edit"\)/);
  assert.match(crosspost, /assertGalleryCrosspostTarget\(c, galleryId\)/);
  assert.match(crosspost, /insertEvent\(c\.env, "work\.crossposted"/);

  const targetGate = sourceBlock(workerEntry, "async function assertGalleryCrosspostTarget", "async function assertWorkCapability");
  assert.match(targetGate, /canCrosspostToGallery\(\{ caps, gallery, user \}\)/);
  assert.doesNotMatch(targetGate, /user\.role === "admin"/);

  const activity = sourceBlock(activitySource, "export async function activityEntryFromJoinedRow", undefined);
  assert.match(activity, /row\.type === "work\.crossposted"/);
  assert.match(activity, /crossposted "\$\{workTitle\}" to "\$\{row\.target_gallery_title \|\| "another gallery"\}"/);
});

test("collaborative gallery settings can add members", () => {
  const addMember = routeBlock('app.post("/api/galleries/:id/members"', 'app.patch("/api/galleries/:id/members/:userId"');
  assert.match(addMember, /assertGalleryCapability\(c, id, "manage_collaborators"\)/);
  assert.match(addMember, /INSERT INTO gallery_members/);
  assert.match(addMember, /can_upload_work/);
  assert.match(addMember, /insertEvent\(c\.env, "gallery\.member_added"/);

  assert.match(appSource, /id="gallery-member-form"/);
  assert.match(appSource, /name="can_upload_work"[\s\S]*checked/);
  assert.match(appSource, /\/api\/galleries\/\$\{encodePath\(id\)\}\/members/);
  assert.match(appSource, /bindMentionAutocomplete\(form\)/);
  assert.match(appSource, /input\[data-mention-input\]/);
});

test("admin role does not grant content visibility or mutation outside admin routes", () => {
  const workPerms = readFileSync("worker/src/permissions.ts", "utf8");
  const workCaps = sourceBlock(workPerms, "export function resolveWorkCapabilities", undefined);
  assert.doesNotMatch(workCaps, /user\.role === "admin"/);
  assert.doesNotMatch(workCaps, /admin/);
  assert.match(workCaps, /view: galleryCaps\.view \|\| ownsWork \|\| !!collaborator/);

  const visibleGalleries = sourceBlock(activitySource, "export async function visibleGalleryIds", "export async function visibleWorkIds");
  const visibleWorks = sourceBlock(activitySource, "export async function visibleWorkIds", "export function collectActivityVisibilityIds");
  const joinedVisibility = sourceBlock(activitySource, "export function joinedEventVisible", "function fallbackThumbnailUrl");
  assert.doesNotMatch(visibleGalleries, /user\.role === "admin"/);
  assert.doesNotMatch(visibleWorks, /user\.role === "admin"/);
  assert.match(joinedVisibility, /return false/);
  assert.doesNotMatch(joinedVisibility, /user\.role === "admin"/);

  const tagsPopular = routeBlock('app.get("/api/tags/popular"', 'app.get("/api/tags/:tag"');
  assert.doesNotMatch(tagsPopular, /\? = 'admin'/);
  assert.doesNotMatch(tagsPopular, /user\.role/);

  const editComment = routeBlock('app.patch("/api/comments/:id"', 'app.delete("/api/comments/:id"');
  const deleteComment = routeBlock('app.delete("/api/comments/:id"', 'app.get("/api/activity"');
  assert.match(editComment, /comment\.author_id !== user\.id/);
  assert.match(deleteComment, /comment\.author_id !== user\.id/);
  assert.doesNotMatch(editComment, /user\.role !== "admin"/);
  assert.doesNotMatch(deleteComment, /user\.role !== "admin"/);

  assert.match(appSource, /Private means only you and explicitly added gallery members can view it/);
  assert.doesNotMatch(appSource, /admins can view it/);
});

test("global feedback request changes are owner-only and dismissals are per-user", () => {
  const feedback = routeBlock('app.post("/api/works/:id/feedback-requested"', 'app.post("/api/works/:id/feedback-requested/dismiss"');
  assert.match(feedback, /assertWorkCapability\(c, c\.req\.param\("id"\), "view"\)/);
  assert.match(feedback, /gate\.work!\.created_by !== user\.id/);
  assert.match(feedback, /DELETE FROM feedback_request_dismissals WHERE work_id = \?/);

  const dismiss = routeBlock('app.post("/api/works/:id/feedback-requested/dismiss"', 'app.delete("/api/works/:id/feedback-requested/dismiss"');
  assert.match(dismiss, /assertWorkCapability\(c, c\.req\.param\("id"\), "view"\)/);
  assert.match(dismiss, /INSERT INTO feedback_request_dismissals/);
  assert.doesNotMatch(dismiss, /UPDATE works/);

  assert.match(feedbackCleanupSource, /export async function clearExpiredFeedbackRequests/);
  assert.match(feedbackCleanupSource, /datetime\(feedback_requested_at\) <= datetime\('now', '-7 days'\)/);
  assert.match(feedbackCleanupSource, /bumpCachedApiCacheToken\(env\)/);
  assert.doesNotMatch(workerRoutes, /app\.use\("\/api\/\*", async \(c, next\) => \{\s*await clearExpiredFeedbackRequests/);
  assert.match(workerEntry, /async scheduled\(_event: ScheduledEvent, env: Env\)/);
  assert.match(workerEntry, /clearExpiredFeedbackRequests\(env\)/);
  assert.match(workerEntry, /rebuildTagIndex\(env\.DB\)/);
  assert.match(wrangler, /"triggers"[\s\S]*"crons"[\s\S]*"17 9 \* \* \*"/);
});

test("exports produce a zip archive with JSON, works CSV, and high-res WebP files", () => {
  const block = routeBlock("async function buildExport", 'app.post("/api/exports/me"');
  assert.match(block, /createZip\(entries\)/);
  assert.match(block, /data\/export\.json/);
  assert.match(block, /works\.csv/);
  assert.match(block, /media\/high-res/);
  assert.match(block, /high_res_webp/);
  assert.match(block, /archive_r2_key/);
  assert.match(block, /archive_size_bytes/);
  assert.match(block, /expires_at/);

  const cleanup = routeBlock("async function cleanupExpiredUndownloadedExports", "async function buildExport");
  assert.match(cleanup, /downloaded_at IS NULL/);
  assert.match(cleanup, /expires_at/);
  assert.match(cleanup, /env\.MEDIA\.delete/);
  assert.match(cleanup, /DELETE FROM export_jobs/);

  const download = routeBlock('app.get("/api/exports/:id"', 'app.get("/api/media/users/:id/:kind"');
  assert.match(download, /archive_r2_key/);
  assert.match(download, /application\/zip/);
  assert.match(download, /content-disposition/);
  assert.match(download, /downloaded_at = COALESCE/);
});

test("service worker does not cache API responses or original media", () => {
  assert.match(serviceWorker, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /pathname\.includes\("\/original"\)/);
  assert.match(serviceWorker, /pathname\.includes\("high-resolution"\)/);
  assert.doesNotMatch(serviceWorker, /MANIFEST_URL|\/manifest\.webmanifest\?v=/);
});

test("human-readable API docs are published through worker routes", () => {
  assert.match(developersPage, /<redoc spec-url="\/api\/openapi\.yaml"><\/redoc>/);
  assert.match(developersPage, /redoc\.standalone\.js/);

  assert.match(workerRoutes, /app\.get\("\/api\/openapi\.yaml"[\s\S]*application\/yaml; charset=utf-8/);
  assert.match(workerRoutes, /app\.get\("\/developers"[\s\S]*\/developers\/[\s\S]*text\/html; charset=utf-8/);
  assert.match(workerRoutes, /app\.get\("\/developers\.html"[\s\S]*\/developers\/[\s\S]*text\/html; charset=utf-8/);
  assert.match(workerRoutes, /app\.get\("\/developers\/api"[\s\S]*\/developers\/[\s\S]*text\/html; charset=utf-8/);
});

test("PWA install icons use instance app icons when configured", () => {
  const index = readFileSync("public/index.html", "utf8");
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(index, /rel="icon" href="\/favicon\.ico" type="image\/png" sizes="32x32"/);
  assert.match(index, /rel="icon" href="\/favicon-32\.png" type="image\/png" sizes="32x32"/);
  assert.match(index, /rel="icon" href="\/favicon-16\.png" type="image\/png" sizes="16x16"/);
  assert.match(index, /rel="icon" href="\/icon-192\.png" type="image\/png" sizes="192x192"/);
  assert.doesNotMatch(index, /alternate icon/);
  assert.match(index, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(workerRoutes, /app\.get\("\/favicon\.ico"[\s\S]*serveInstanceAppIcon\(c, "any", "\/icon-192\.png", "32"\)/);
  assert.match(workerRoutes, /app\.get\("\/favicon-16\.png"[\s\S]*serveInstanceAppIcon\(c, "any", "\/icon-192\.png", "16"\)/);
  assert.match(workerRoutes, /app\.get\("\/favicon-32\.png"[\s\S]*serveInstanceAppIcon\(c, "any", "\/icon-192\.png", "32"\)/);
  assert.match(workerRoutes, /app\.get\("\/apple-touch-icon\.png"[\s\S]*serveInstanceAppIcon\(c, "any", "\/icon-192\.png", "192"\)/);
  assert.match(workerRoutes, /app\.get\("\/icon-192\.png"[\s\S]*serveInstanceAppIcon\(c, "any", "\/icon-192\.png", "192"\)/);
  assert.match(workerRoutes, /app\.get\("\/icon-512\.png"[\s\S]*serveInstanceAppIcon\(c, "any", "\/icon-512\.png", "512"\)/);
  assert.match(workerRoutes, /app\.get\("\/icon-maskable-192\.png"[\s\S]*serveInstanceAppIcon\(c, "maskable", "\/icon-maskable-192\.png", "192"\)/);
  assert.match(workerRoutes, /app\.get\("\/icon-maskable-512\.png"[\s\S]*serveInstanceAppIcon\(c, "maskable", "\/icon-maskable-512\.png", "512"\)/);
  assert.match(workerRoutes, /app\.get\("\/api\/instance\/app-icon\/:kind\/:size"[\s\S]*serveInstanceAppIcon\(c, kind, undefined, size\)/);
  assert.match(workerRoutes, /app\.get\("\/api\/instance\/app-icon\/:kind"[\s\S]*serveInstanceAppIcon\(c, kind\)/);
  assert.match(workerRoutes, /application\/manifest\+json; charset=utf-8/);
  assert.match(workerRoutes, /src: "\/icon-maskable-192\.png"[\s\S]*purpose: "maskable"/);
  assert.match(workerRoutes, /src: "\/icon-192\.png"[\s\S]*purpose: "any"/);
  assert.doesNotMatch(workerRoutes, /src: "\/icon\.svg"[\s\S]*purpose: "any"/);
  assert.match(workerRoutes, /app_icon_16/);
  assert.match(workerRoutes, /app_icon_32/);
  assert.match(workerRoutes, /app_icon_192/);
  assert.match(workerRoutes, /app_maskable_icon_192/);
  assert.match(workerRoutes, /app_maskable_icon/);
  assert.match(workerRoutes, /\$\{settingPrefix\}_updated_at/);
  assert.match(stylesSource, /display-mode: standalone/);
  assert.match(stylesSource, /safe-area-inset-bottom/);
  assert.match(stylesSource, /height: max\(28px, env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(stylesSource, /overscroll-behavior: none/);
  assert.match(stylesSource, /min-height: 100dvh/);
});

test("public instance settings are cached outside per-key D1 reads", () => {
  assert.match(workerEntry, /PUBLIC_INSTANCE_SETTINGS_CACHE_VERSION = 3/);
  assert.match(workerEntry, /"site_url"/);
  assert.match(workerEntry, /site_url: valueFromSettings\(values, "site_url", env\.SITE_URL \|\| ""\)/);
  assert.match(workerEntry, /SELECT key, value_json FROM instance_settings WHERE key IN/);
  assert.doesNotMatch(workerEntry, /env\.SETTINGS_CACHE/);
  assert.match(instanceCacheSource, /export class InstanceCacheObject implements DurableObject/);
  assert.match(instanceCacheSource, /PUBLIC_SETTINGS_STORAGE_KEY = "public-settings:v1"/);
  assert.match(workerEntry, /readCachedPublicInstanceSettings<PublicInstanceSettings>\(env, PUBLIC_INSTANCE_SETTINGS_CACHE_VERSION\)/);
  assert.match(workerEntry, /writeCachedPublicInstanceSettings\(env, settings, PUBLIC_INSTANCE_SETTINGS_CACHE_VERSION\)/);
  assert.match(wrangler, /"durable_objects"[\s\S]*"INSTANCE_CACHE"[\s\S]*"InstanceCacheObject"/);
  assert.match(wrangler, /"new_sqlite_classes"[\s\S]*"InstanceCacheObject"/);
  assert.match(workerRoutes, /refreshPublicInstanceSettings\(c\.env\)/);
  const manifestBlock = routeBlock('app.get("/manifest.webmanifest"', 'app.get("/api/setup/status"');
  assert.doesNotMatch(manifestBlock, /getSetting\(c\.env\.DB/);
  const iconBlock = sourceBlock(workerRoutes, 'async function serveInstanceAppIcon', 'async function storeInstanceAppIcon');
  assert.doesNotMatch(iconBlock, /getSetting\(c\.env\.DB/);
});

test("admin-configured site URL is used for generated external links", () => {
  assert.match(adminViewSource, /<label>Site URL<\/label><input name="site_url" type="url"/);
  assert.match(workerRoutes, /function normalizeSiteUrl/);
  assert.match(workerRoutes, /async function siteOrigin/);
  assert.match(workerRoutes, /getSetting\(c\.env\.DB, "site_url", c\.env\.SITE_URL \|\| ""\)/);
  assert.match(workerRoutes, /await setSetting\(c\.env\.DB, "site_url", siteUrl/);
  assert.match(workerRoutes, /Site URL must be a valid http or https URL/);
  assert.match(workerRoutes, /reset_url: await absoluteUrl\(c, `\/reset-password\/\$\{token\}`\)/);
  assert.match(workerRoutes, /const inviteUrl = await absoluteUrl\(c, `\/invite\/\$\{token\}`\)/);
  assert.match(workerRoutes, /absolute_url: token \? await absoluteUrl\(c, `\/invite\/\$\{token\}`\) : null/);
  assert.doesNotMatch(workerRoutes, /reset_url: absoluteUrl/);
  assert.doesNotMatch(workerRoutes, /const inviteUrl = absoluteUrl/);
});

test("server rules render from markdown and expose acceptance status", () => {
  assert.match(workerRoutes, /current_rule_published_at: rules\.current\?\.published_at \|\| null/);
  assert.match(appSource, /const rules = state\.me\?\.current_rule_version_id/);
  assert.match(appSource, /\$\{source\}\s*\$\{rules\}/);
  assert.match(appSource, /href="\/rules\/accept"/);
  assert.doesNotMatch(appSource, /rulesFooterStatus|sidebar-rules-status|current_rule_published_at|current_rule_accepted_at|<strong>Server Rules/);
  assert.match(appSource, /const heading = line\.match/);
  assert.match(appSource, /<blockquote>/);
  assert.match(appSource, /<hr>/);
  assert.match(authViewSource, /renderMarkdown\(current\.body_markdown \|\| current\.body_html\)/);
  assert.match(authViewSource, /renderMarkdown\(previous\.body_markdown \|\| previous\.body_html\)/);
  assert.doesNotMatch(authViewSource, /current\.body_html \|\| renderMarkdown/);
  assert.match(authViewSource, /You agreed to this version/);
  assert.match(authPageSource, /if \(!rules\.required\) return/);
  assert.doesNotMatch(authPageSource, /if \(!rules\.required\) \{\s*navigate\("\/"\)/);
  assert.match(adminViewSource, /renderMarkdown\(rule\.body_markdown \|\| rule\.body_html\)/);
});

test("D1 row metrics are exposed on response headers", () => {
  assert.match(workerEntry, /instrumentD1Env\(env\)/);
  assert.match(workerEntry, /withD1MetricsHeaders\(response, instrumented\.metrics\)/);
  assert.match(d1MetricsSource, /"X-D1-Rows-Read"/);
  assert.match(d1MetricsSource, /"X-D1-Rows-Written"/);
  assert.match(d1MetricsSource, /"X-D1-Query-Count"/);
  assert.match(d1MetricsSource, /rows_read/);
  assert.match(d1MetricsSource, /rows_written/);
  assert.match(d1MetricsSource, /prop === "first"[\s\S]*target\.run/);
  assert.match(d1MetricsSource, /prop === "batch"[\s\S]*recordD1Result/);
});

test("wrangler config keeps R2 private and omits S3 signing secrets", () => {
  const config = JSON.parse(wrangler.replace(/\/\/.*$/gm, ""));
  assert.equal(config.d1_databases[0].database_name, "quietcollective");
  assert.equal(config.r2_buckets[0].bucket_name, "quietcollective-media");
  assert.equal(config.queues.producers[0].queue, "quietcollective-jobs");
  assert.equal(config.queues.consumers[0].queue, "quietcollective-jobs");
  assert.equal(config.vars.R2_BUCKET_NAME, "quietcollective-media");
  assert.equal(config.vars.R2_ACCOUNT_ID, "");
  assert.ok(!("R2_ACCESS_KEY_ID" in config.vars));
  assert.ok(!("R2_SECRET_ACCESS_KEY" in config.vars));
  assert.ok(config.assets.run_worker_first.includes("/api/*"));
  assert.ok(config.assets.run_worker_first.includes("/favicon.ico"));
  assert.ok(config.assets.run_worker_first.includes("/favicon-16.png"));
  assert.ok(config.assets.run_worker_first.includes("/favicon-32.png"));
  assert.ok(config.assets.run_worker_first.includes("/apple-touch-icon.png"));
  assert.ok(config.assets.run_worker_first.includes("/icon-192.png"));
  assert.ok(config.assets.run_worker_first.includes("/icon-512.png"));
  assert.ok(config.assets.run_worker_first.includes("/icon-maskable-192.png"));
  assert.ok(config.assets.run_worker_first.includes("/icon-maskable-512.png"));
  assert.ok(config.assets.run_worker_first.includes("/developers*"));
  assert.ok(config.assets.run_worker_first.includes("/manifest.webmanifest"));
});

let passed = 0;
for (const check of checks) {
  try {
    await check.fn();
    passed += 1;
    console.log(`ok - ${check.name}`);
  } catch (error) {
    console.error(`not ok - ${check.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`security regression checks passed (${passed}/${checks.length})`);
