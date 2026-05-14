import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".yaml", "application/yaml; charset=utf-8"],
  [".yml", "application/yaml; charset=utf-8"],
]);

function safeAssetPath(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const relativePath = decoded || "index.html";
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

async function existingFile(candidate) {
  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const indexPath = path.join(candidate, "index.html");
      const indexInfo = await stat(indexPath);
      if (indexInfo.isFile()) return indexPath;
    }
  } catch {
    return null;
  }
  return null;
}

export class StaticAssetsBinding {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const candidate = safeAssetPath(this.rootDir, url.pathname);
    const filePath = candidate ? await existingFile(candidate) : null;
    const fallbackPath = await existingFile(path.join(this.rootDir, "index.html"));
    const selected = filePath || fallbackPath;
    if (!selected) return new Response("Not found", { status: 404 });

    const headers = new Headers({
      "Content-Type": CONTENT_TYPES.get(path.extname(selected).toLowerCase()) || "application/octet-stream",
      "Cache-Control": selected === fallbackPath && !filePath ? "no-store" : "public, max-age=300",
    });
    return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(selected)), { headers });
  }
}
