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
  "web/src/app/api.ts",
  "web/src/app/notifications.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const serviceWorker = readFileSync("public/sw.js", "utf8");
const wrangler = readFileSync("wrangler.jsonc", "utf8");
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
  assert.ok(reactions.indexOf("canViewTarget") < reactions.indexOf("INSERT OR IGNORE INTO reactions"));
  assert.ok(reactions.indexOf("canViewTarget") < reactions.indexOf("insertEvent"));
});

test("notifications use the joined activity context instead of the old N+1 formatter", () => {
  const block = routeBlock('app.get("/api/notifications"', 'app.get("/api/notifications/poll"');
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

test("notification polling does not update member activity", () => {
  const block = sourceBlock(workerEntry, "function requestCountsAsActivity", "function currentUser");
  assert.match(block, /c\.req\.path !== "\/api\/notifications\/poll"/);
  assert.ok(block.indexOf("requestCountsAsActivity(c)") < block.indexOf("UPDATE users SET last_active_at"));
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
  assert.match(block, /MAX\(created_at\) AS latest_created_at/);
  assert.doesNotMatch(block, /sanitizeEtagPart\(since \|\| "all"\)/);
  assert.match(block, /etagMatches\(c\.req\.header\("if-none-match"\), etag\)/);
  assert.ok(block.indexOf("apiNotModified(cache)") < block.indexOf("WITH recent AS"));
  assert.match(block, /ACTIVITY_CONTEXT_SELECT/);
  assert.match(block, /activityEntryFromJoinedRow/);
  assert.match(block, /action_url: row\.notification_action_url \|\| activity\?\.href \|\| "\/"/);
  assert.match(block, /X-Recent-Poll-Interval-Ms/);
  assert.match(block, /X-Followup-Poll-Interval-Ms/);

  assert.match(appSource, /NOTIFICATION_RECENT_POLL_INTERVAL_MS = 60 \* 1000/);
  assert.match(appSource, /NOTIFICATION_RECENT_WINDOW_MS = 30 \* 60 \* 1000/);
  assert.match(appSource, /NOTIFICATION_FOLLOWUP_POLL_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(appSource, /NOTIFICATION_FOLLOWUP_WINDOW_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(appSource, /periodicSync\.register\("qc-notifications"/);
  assert.match(appSource, /browserPushSubscriptionActive\) return NOTIFICATION_IDLE_POLL_INTERVAL_MS/);
  assert.match(appSource, /pushSubscribed \? NOTIFICATION_IDLE_POLL_INTERVAL_MS : NOTIFICATION_RECENT_POLL_INTERVAL_MS/);
  assert.match(appSource, /NOTIFICATION_TITLE_PREFIX/);
  assert.match(appSource, /document\.title = Number\(state\.unreadNotifications \|\| 0\) > 0/);
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

test("gallery posting is limited to eligible target galleries", () => {
  const createWork = routeBlock('app.post("/api/galleries/:galleryId/works"', 'app.get("/api/works/:id"');
  assert.match(createWork, /assertGalleryCapability\(c, galleryId, "upload_work"\)/);

  const galleryCaps = sourceBlock(workerEntry, "async function galleryCapabilities", "async function getWork");
  assert.match(galleryCaps, /resolveGalleryCapabilities\(\{ baseCaps, gallery, member \}\)/);
  assert.doesNotMatch(galleryCaps, /user\.role === "admin"\) return OWNER_CAPABILITIES/);

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

test("wrangler config keeps R2 private by serving assets through the Worker API only", () => {
  const config = JSON.parse(wrangler.replace(/\/\/.*$/gm, ""));
  assert.equal(config.r2_buckets[0].bucket_name, "quietcollective-media");
  assert.ok(config.assets.run_worker_first.includes("/api/*"));
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
