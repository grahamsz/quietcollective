import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/styles.min.css",
  "public/sw.js",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/icon-maskable-192.png",
  "public/icon-maskable-512.png",
  "public/icon-maskable.svg",
  "public/vendor/easymde/easymde.min.css",
  "public/vendor/easymde/easymde.min.js",
  "public/manifest.webmanifest",
  "public/api/openapi.yaml",
  "public/developers.html",
  "public/developers/index.html",
];

for (const file of requiredFiles) {
  await access(file);
}

const serviceWorker = await readFile("public/sw.js", "utf8");
if (!serviceWorker.includes("/api/") || !serviceWorker.includes("original")) {
  throw new Error("public/sw.js must avoid caching API and original media routes");
}
const developersPage = await readFile("public/developers.html", "utf8");
if (!developersPage.includes('<redoc spec-url="/api/openapi.yaml"></redoc>')) {
  throw new Error("public/developers.html must render the public OpenAPI spec with Redoc");
}
const developersIndex = await readFile("public/developers/index.html", "utf8");
if (developersIndex !== developersPage) {
  throw new Error("public/developers/index.html must match public/developers.html");
}
const index = await readFile("public/index.html", "utf8");
if (!/<meta name="qc-build" content="[a-f0-9]{12}">/.test(index)) {
  throw new Error("public/index.html must include the build fingerprint meta tag");
}
if (
  !/href="\/manifest\.webmanifest"/.test(index) ||
  !/href="\/styles\.min\.css\?v=[a-f0-9]{12}"/.test(index) ||
  !/src="\/app\.js\?v=[a-f0-9]{12}"/.test(index)
) {
  throw new Error("public/index.html must reference the manifest and versioned app and stylesheet assets");
}
if (!/quietcollective-shell-[a-f0-9]{12}/.test(serviceWorker)) {
  throw new Error("public/sw.js must use a build-fingerprinted shell cache name");
}
if (/MANIFEST_URL|\/manifest\.webmanifest\?v=/.test(serviceWorker)) {
  throw new Error("public/sw.js must not cache the dynamic web app manifest");
}
const manifest = JSON.parse(await readFile("public/manifest.webmanifest", "utf8"));
if (manifest.display !== "standalone" || manifest.scope !== "/" || manifest.start_url !== "/" || !manifest.id) {
  throw new Error("public/manifest.webmanifest must define installable app metadata");
}
for (const src of ["/icon-192.png", "/icon-512.png", "/icon-maskable-192.png", "/icon-maskable-512.png"]) {
  if (!manifest.icons?.some((icon) => icon.src === src)) throw new Error(`public/manifest.webmanifest is missing ${src}`);
}

console.log("Public app assets are present.");
