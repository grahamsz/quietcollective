import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

function hash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function replaceOrThrow(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Could not update ${label}`);
  return source.replace(pattern, replacement);
}

const [appJs, stylesCss, manifest] = await Promise.all([
  readFile("public/app.js"),
  readFile("public/styles.css"),
  readFile("public/manifest.webmanifest"),
]);

const appHash = hash(appJs);
const stylesHash = hash(stylesCss);
const manifestHash = hash(manifest);
const buildHash = hash(`${appHash}:${stylesHash}:${manifestHash}`);

let index = await readFile("public/index.html", "utf8");
index = replaceOrThrow(
  index,
  /<meta name="qc-build" content="[^"]*">/,
  `<meta name="qc-build" content="${buildHash}">`,
  "index build meta",
);
index = replaceOrThrow(
  index,
  /href="\/manifest\.webmanifest(?:\?v=[^"]*)?"/,
  `href="/manifest.webmanifest?v=${manifestHash}"`,
  "manifest link",
);
index = replaceOrThrow(
  index,
  /href="\/styles\.css(?:\?v=[^"]*)?"/,
  `href="/styles.css?v=${stylesHash}"`,
  "styles link",
);
index = replaceOrThrow(
  index,
  /src="\/app\.js(?:\?v=[^"]*)?"/,
  `src="/app.js?v=${appHash}"`,
  "app script",
);
await writeFile("public/index.html", index);

let serviceWorker = await readFile("public/sw.js", "utf8");
serviceWorker = replaceOrThrow(
  serviceWorker,
  /const CACHE_NAME = "quietcollective-shell-[^"]+";/,
  `const CACHE_NAME = "quietcollective-shell-${buildHash}";`,
  "service worker cache name",
);
serviceWorker = replaceOrThrow(
  serviceWorker,
  /const STYLES_CSS_URL = "\/styles\.css(?:\?v=[^"]*)?";/,
  `const STYLES_CSS_URL = "/styles.css?v=${stylesHash}";`,
  "service worker styles URL",
);
serviceWorker = replaceOrThrow(
  serviceWorker,
  /const APP_JS_URL = "\/app\.js(?:\?v=[^"]*)?";/,
  `const APP_JS_URL = "/app.js?v=${appHash}";`,
  "service worker app URL",
);
serviceWorker = replaceOrThrow(
  serviceWorker,
  /const MANIFEST_URL = "\/manifest\.webmanifest(?:\?v=[^"]*)?";/,
  `const MANIFEST_URL = "/manifest.webmanifest?v=${manifestHash}";`,
  "service worker manifest URL",
);
await writeFile("public/sw.js", serviceWorker);

console.log(`Versioned public assets: ${buildHash}`);
