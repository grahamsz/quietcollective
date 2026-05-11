import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync("worker/src/index.ts", "utf8");
const serviceWorker = readFileSync("public/sw.js", "utf8");
const wrangler = readFileSync("wrangler.jsonc", "utf8");
const checks = [];

function test(name, fn) {
  checks.push({ name, fn });
}

function routeBlock(start, end) {
  const startIndex = worker.indexOf(start);
  assert.notEqual(startIndex, -1, `missing route start: ${start}`);
  const endIndex = end ? worker.indexOf(end, startIndex + start.length) : worker.length;
  assert.notEqual(endIndex, -1, `missing route end: ${end}`);
  return worker.slice(startIndex, endIndex);
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
    "/api/notifications*",
    "/api/exports*",
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
  const block = routeBlock('app.get("/api/notifications"', 'app.post("/api/notifications/:id/read"');
  assert.match(block, /ACTIVITY_CONTEXT_SELECT/);
  assert.match(block, /joinedEventVisible/);
  assert.match(block, /activityEntryFromJoinedRow/);
  assert.doesNotMatch(block, /activityEntry\(c\.env/);
});

test("private media stays permission-gated and signed media validates HMAC payloads", () => {
  const signed = routeBlock('app.get("/api/media/signed/:token"', 'app.use("/api/admin/*"');
  assert.match(signed, /readSignedMediaPayload\(c\.env, c\.req\.param\("token"\)\)/);
  assert.match(signed, /if \(!payload\) return c\.json\(\{ error: "Forbidden" \}, 403\)/);
  assert.ok(worker.indexOf('app.get("/api/media/signed/:token"') < worker.indexOf('app.use("/api/media/*", requireUser)'));

  const cacheControl = routeBlock("function cacheControl", "function getSecret");
  assert.match(cacheControl, /variant === "original"[\s\S]*"private, no-store"/);
});

test("service worker does not cache API responses or original media", () => {
  assert.match(serviceWorker, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /pathname\.includes\("\/original"\)/);
  assert.match(serviceWorker, /pathname\.includes\("high-resolution"\)/);
});

test("wrangler config keeps R2 private by serving assets through the Worker API only", () => {
  const config = JSON.parse(wrangler.replace(/\/\/.*$/gm, ""));
  assert.equal(config.r2_buckets[0].bucket_name, "quietcollective-media");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
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
