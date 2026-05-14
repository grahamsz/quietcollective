import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

function metadataPath(objectPath) {
  return `${objectPath}.metadata.json`;
}

function safeObjectPath(rootDir, key) {
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!cleanKey || cleanKey.includes("\0")) throw new Error("Invalid media key");
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, cleanKey);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Invalid media key");
  }
  return resolved;
}

async function bytesFromBody(body) {
  if (body == null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof body.getReader === "function") return new Uint8Array(await new Response(body).arrayBuffer());
  if (typeof body.pipe === "function") {
    const chunks = [];
    for await (const chunk of body) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported media body");
}

class FilesystemR2Object {
  constructor(objectPath, metadata) {
    this.objectPath = objectPath;
    this.httpMetadata = metadata.httpMetadata || {};
    this.customMetadata = metadata.customMetadata || {};
    this.body = Readable.toWeb(createReadStream(objectPath));
  }

  async arrayBuffer() {
    const data = await readFile(this.objectPath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  async text() {
    return readFile(this.objectPath, "utf8");
  }
}

export class FilesystemMediaBucket {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async put(key, body, options = {}) {
    const objectPath = safeObjectPath(this.rootDir, key);
    await mkdir(path.dirname(objectPath), { recursive: true });
    await writeFile(objectPath, await bytesFromBody(body));
    await writeFile(metadataPath(objectPath), JSON.stringify({
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
      uploaded: new Date().toISOString(),
    }, null, 2));
    return null;
  }

  async get(key) {
    const objectPath = safeObjectPath(this.rootDir, key);
    try {
      const info = await stat(objectPath);
      if (!info.isFile()) return null;
    } catch {
      return null;
    }
    const metadata = await readFile(metadataPath(objectPath), "utf8")
      .then((value) => JSON.parse(value))
      .catch(() => ({}));
    return new FilesystemR2Object(objectPath, metadata);
  }

  async delete(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    await Promise.all(keyList.map(async (key) => {
      const objectPath = safeObjectPath(this.rootDir, key);
      await rm(objectPath, { force: true }).catch(() => undefined);
      await rm(metadataPath(objectPath), { force: true }).catch(() => undefined);
    }));
  }
}

