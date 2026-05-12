import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerEntry = readFileSync("worker/src/index.ts", "utf8");
const workerRoutes = readFileSync("worker/src/routes.ts", "utf8");
const workerConstants = readFileSync("worker/src/constants.ts", "utf8");
const webPushSource = readFileSync("worker/src/web-push.ts", "utf8");
const worker = `${workerEntry}\n${workerRoutes}\n${workerConstants}\n${webPushSource}`;
const activitySource = readFileSync("worker/src/activity.ts", "utf8");
const apiCacheSource = readFileSync("worker/src/api-cache.ts", "utf8");
const mediaSource = readFileSync("worker/src/media.ts", "utf8");
const utilsSource = readFileSync("worker/src/utils.ts", "utf8");
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
  const block = routeBlock('app.get("/api/comments"', 'app.post("/api/reactions/:targetType/:targetId/heart"');
  assert.match(block, /canViewTarget\(c\.env\.DB, currentUser\(c\), targetType, targetId\)/);
  assert.match(block, /WHERE comments\.target_type = \? AND comments\.target_id = \?/);
  assert.doesNotMatch(block, /WHERE target_type = \? AND target_id = \?/);
  assert.match(block, /COUNT\(reactions\.id\) AS heart_count/);
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
  const block = routeBlock('app.get("/api/notifications"', 'app.get("/api/notifications/poll"');
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
  assert.match(collaboratorBlock, /insertEvent\(c\.env, "work\.collaborator_added"[\s\S]*user_id: linkedUserId/);
});

test("work collaborators can credit the same linked user for multiple roles", () => {
  const createBlock = routeBlock("async function createWorkCollaborator", 'app.post("/api/galleries/:galleryId/works"');
  assert.match(createBlock, /lower\(role_label\) = lower\(\?\)/);
  assert.doesNotMatch(createBlock, /SELECT id FROM work_collaborators WHERE work_id = \? AND user_id = \?["`]/);
  assert.match(createBlock, /INSERT INTO work_collaborators/);
  assert.match(createBlock, /insertEvent\(c\.env, "work\.collaborator_added"/);

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

test("activity and mention notifications stay scoped to visible content", () => {
  const joinedVisibility = sourceBlock(activitySource, "export function joinedEventVisible", "function fallbackThumbnailUrl");
  assert.match(joinedVisibility, /row\.subject_type === "user"\) return row\.type === "user\.joined"/);
  assert.doesNotMatch(joinedVisibility, /row\.subject_type === "user" \|\| row\.subject_type === "profile"/);

  const eventBlock = sourceBlock(workerEntry, "async function processEvent", "async function galleryAccessUsers");
  assert.match(workerEntry, /async function canUserViewTarget/);
  assert.match(eventBlock, /canUserViewTarget\(env\.DB, row\.id, event\.target_type, event\.target_id\)/);
  assert.doesNotMatch(eventBlock, /for \(const row of mentioned\.results\) targets\.add\(row\.id\)/);
});

test("private media stays permission-gated and signed media validates HMAC payloads", () => {
  const signed = routeBlock('app.get("/api/media/signed/:token"', 'app.use("/api/admin/*"');
  assert.match(signed, /readSignedMediaPayload\(c\.env, c\.req\.param\("token"\)\)/);
  assert.match(signed, /if \(!payload\) return c\.json\(\{ error: "Forbidden" \}, 403\)/);
  assert.ok(worker.indexOf('app.get("/api/media/signed/:token"') < worker.indexOf('app.use("/api/media/*", requireUser)'));

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
  assert.ok(helpers.includes('replace(/^W\\//i, "")'));

  const middleware = routeBlock('app.use("*", async (c, next) => {', 'app.get("/api/health"');
  assert.match(middleware, /mutatingApiRequest\(c\)/);
  assert.match(middleware, /bumpApiCacheToken\(c\.env\.DB\)/);
  assert.match(middleware, /!c\.res\.headers\.has\("Cache-Control"\)/);

  const galleries = routeBlock('app.get("/api/galleries"', 'app.post("/api/galleries/:id/pin"');
  assert.ok(galleries.indexOf("prepareApiCache") < galleries.indexOf("SELECT * FROM galleries ORDER BY updated_at DESC"));
  assert.match(galleries, /apiNotModified\(cache\)/);
  assert.match(galleries, /cacheableJson\(c, cache, \{ galleries \}\)/);

  const gallery = routeBlock('app.get("/api/galleries/:id"', 'app.get("/api/galleries/:id/crosspost-candidates"');
  assert.ok(gallery.indexOf("prepareApiCache") < gallery.indexOf("SELECT * FROM galleries WHERE id = ?"));
  assert.match(gallery, /apiNotModified\(cache\)/);
  assert.match(gallery, /cacheableJson\(c, cache,/);

  const comments = routeBlock('app.get("/api/comments"', 'app.post("/api/reactions/:targetType/:targetId/heart"');
  assert.ok(comments.indexOf("prepareApiCache") < comments.indexOf("SELECT comments.*, users.display_name"));
  assert.match(comments, /cacheableJson\(c, cache, \{ comments \}\)/);

  const activity = routeBlock('app.get("/api/activity"', 'app.get("/api/notifications"');
  assert.ok(activity.indexOf("prepareApiCache") < activity.indexOf("WITH recent AS"));
  assert.match(activity, /cacheableJson\(c, cache, \{ events \}\)/);

  const notifications = routeBlock('app.get("/api/notifications"', 'app.get("/api/notifications/poll"');
  assert.ok(notifications.indexOf("prepareApiCache") < notifications.indexOf("WITH recent AS"));
  assert.match(notifications, /cacheableJson\(c, cache, \{ notifications \}\)/);

  const clientCache = appSource.slice(appSource.indexOf("function isCacheableApiRequest"), appSource.indexOf("async function api"));
  assert.match(clientCache, /API_JSON_CACHEABLE_PATHS/);
  assert.doesNotMatch(clientCache, /state\.me/);
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
});

test("human-readable API docs are published through worker routes", () => {
  assert.match(developersPage, /<redoc spec-url="\/api\/openapi\.yaml"><\/redoc>/);
  assert.match(developersPage, /redoc\.standalone\.js/);

  assert.match(workerRoutes, /app\.get\("\/api\/openapi\.yaml"[\s\S]*application\/yaml; charset=utf-8/);
  assert.match(workerRoutes, /app\.get\("\/developers"[\s\S]*\/developers\/[\s\S]*text\/html; charset=utf-8/);
  assert.match(workerRoutes, /app\.get\("\/developers\.html"[\s\S]*\/developers\/[\s\S]*text\/html; charset=utf-8/);
  assert.match(workerRoutes, /app\.get\("\/developers\/api"[\s\S]*\/developers\/[\s\S]*text\/html; charset=utf-8/);
});

test("wrangler config keeps R2 private by serving assets through the Worker API only", () => {
  const config = JSON.parse(wrangler.replace(/\/\/.*$/gm, ""));
  assert.equal(config.r2_buckets[0].bucket_name, "quietcollective-media");
  assert.ok(config.assets.run_worker_first.includes("/api/*"));
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
