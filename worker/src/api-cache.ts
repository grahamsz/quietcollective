import type { Context } from "hono";
import { ulid } from "ulid";
import { jsonText, now } from "./utils";

export const API_CACHE_TOKEN_KEY = "api_cache_token";
export const API_CACHE_CONTROL = "private, no-cache";
export const API_CACHE_MEDIA_REFRESH_MS = 6 * 60 * 60 * 1000;

export type ApiCacheState = {
  etag: string;
  fresh: boolean;
};

function apiCacheRenderBucket() {
  return Math.floor(Date.now() / API_CACHE_MEDIA_REFRESH_MS).toString(36);
}

export function sanitizeEtagPart(value: string) {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 220);
}

export function apiCacheHeaders(etag: string) {
  return {
    "Cache-Control": API_CACHE_CONTROL,
    "ETag": etag,
    "Vary": "Authorization, Cookie",
  };
}

export function setApiCacheHeaders(c: Context, etag: string) {
  for (const [key, value] of Object.entries(apiCacheHeaders(etag))) c.header(key, value);
}

export function etagMatches(header: string | null | undefined, etag: string) {
  if (!header) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//i, "");
  const normalizedEtag = normalize(etag);
  return header.split(",").some((value) => {
    const normalized = normalize(value);
    return normalized === "*" || normalized === normalizedEtag;
  });
}

async function getApiCacheToken(db: D1Database) {
  const row = await db.prepare("SELECT value_json FROM instance_settings WHERE key = ?").bind(API_CACHE_TOKEN_KEY).first<{ value_json: string }>();
  try {
    return row?.value_json ? JSON.parse(row.value_json).value || "0" : "0";
  } catch {
    return "0";
  }
}

export async function bumpApiCacheToken(db: D1Database) {
  const token = `${Date.now().toString(36)}_${ulid()}`;
  const timestamp = now();
  await db.prepare(
    `INSERT INTO instance_settings (key, value_json, description, created_at, updated_at)
     VALUES (?, ?, 'Coarse invalidation token for cacheable API reads.', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).bind(API_CACHE_TOKEN_KEY, jsonText({ value: token }), timestamp, timestamp).run();
  return token;
}

export async function prepareApiCache(db: D1Database, userId: string, ifNoneMatch: string | null | undefined, scope: string): Promise<ApiCacheState> {
  const token = await getApiCacheToken(db);
  const etag = `W/"qc:${sanitizeEtagPart(scope)}:${sanitizeEtagPart(userId)}:${apiCacheRenderBucket()}:${sanitizeEtagPart(token)}"`;
  return { etag, fresh: etagMatches(ifNoneMatch, etag) };
}

export function apiNotModified(cache: ApiCacheState) {
  return new Response(null, { status: 304, headers: apiCacheHeaders(cache.etag) });
}

export function cacheableJson(c: Context, cache: ApiCacheState, data: unknown) {
  setApiCacheHeaders(c, cache.etag);
  return c.json(data);
}

export function mutatingApiRequest(c: Context) {
  const method = c.req.method.toUpperCase();
  return c.req.path.startsWith("/api/") &&
    !c.req.path.startsWith("/api/media/signed/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    c.res.status >= 200 &&
    c.res.status < 400;
}
