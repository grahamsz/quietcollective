import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/sw.js",
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

console.log("Public app assets are present.");
