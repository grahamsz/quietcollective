import { bumpApiCacheToken, createApiCacheToken, readApiCacheTokenFromD1, writeApiCacheTokenToD1 } from "./api-cache";
import type { Env } from "./types";
import { now } from "./utils";

const INSTANCE_CACHE_OBJECT_NAME = "instance";
const INSTANCE_CACHE_ORIGIN = "https://instance-cache.internal";
const API_CACHE_TOKEN_STORAGE_KEY = "api-cache-token:v1";
const PUBLIC_SETTINGS_STORAGE_KEY = "public-settings:v1";

type PublicSettingsCacheEntry<T = unknown> = {
  cache_version: number;
  settings: T;
  updated_at: string;
};

const LOCATION_HINTS = new Set(["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"]);

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function instanceCacheLocationHint(env: Env): DurableObjectLocationHint | undefined {
  const hint = env.INSTANCE_CACHE_LOCATION_HINT;
  return hint && LOCATION_HINTS.has(hint) ? hint as DurableObjectLocationHint : undefined;
}

function instanceCacheStub(env: Env) {
  if (!env.INSTANCE_CACHE) return null;
  const id = env.INSTANCE_CACHE.idFromName(INSTANCE_CACHE_OBJECT_NAME);
  const locationHint = instanceCacheLocationHint(env);
  return env.INSTANCE_CACHE.get(id, locationHint ? { locationHint } : undefined);
}

async function fetchInstanceCache(env: Env, path: string, init?: RequestInit) {
  const stub = instanceCacheStub(env);
  if (!stub) return null;
  return stub.fetch(`${INSTANCE_CACHE_ORIGIN}${path}`, init).catch(() => null);
}

async function responseJson<T>(response: Response | null) {
  if (!response?.ok) return null;
  return response.json().then((value) => value as T).catch(() => null);
}

export async function readCachedApiCacheToken(env: Env) {
  const body = await responseJson<{ token?: unknown }>(await fetchInstanceCache(env, "/api-cache-token"));
  return typeof body?.token === "string" ? body.token : readApiCacheTokenFromD1(env.DB);
}

export async function bumpCachedApiCacheToken(env: Env) {
  const body = await responseJson<{ token?: unknown }>(await fetchInstanceCache(env, "/api-cache-token/bump", { method: "POST" }));
  return typeof body?.token === "string" ? body.token : bumpApiCacheToken(env.DB);
}

export async function readCachedPublicInstanceSettings<T>(env: Env, cacheVersion: number) {
  const body = await responseJson<{ cache_version?: unknown; settings?: T }>(
    await fetchInstanceCache(env, `/public-settings?version=${encodeURIComponent(String(cacheVersion))}`),
  );
  return body?.cache_version === cacheVersion ? body.settings ?? null : null;
}

export async function writeCachedPublicInstanceSettings<T>(env: Env, settings: T, cacheVersion: number) {
  await fetchInstanceCache(env, "/public-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cache_version: cacheVersion, settings }),
  });
}

export class InstanceCacheObject implements DurableObject {
  private apiCacheToken: string | null = null;
  private publicSettings: PublicSettingsCacheEntry | null = null;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api-cache-token") {
      return json({ token: await this.readApiCacheToken() });
    }
    if (request.method === "POST" && url.pathname === "/api-cache-token/bump") {
      return json({ token: await this.bumpApiCacheToken() });
    }
    if (request.method === "GET" && url.pathname === "/public-settings") {
      const cacheVersion = Number(url.searchParams.get("version") || "0");
      const entry = await this.readPublicSettings(cacheVersion);
      return entry ? json(entry) : json({ error: "Cache miss" }, { status: 404 });
    }
    if (request.method === "PUT" && url.pathname === "/public-settings") {
      const entry = await request.json().then((value) => value as PublicSettingsCacheEntry).catch(() => null);
      if (!entry || typeof entry.cache_version !== "number" || entry.settings == null) return json({ error: "Invalid cache entry" }, { status: 400 });
      await this.writePublicSettings(entry.cache_version, entry.settings);
      return json({ ok: true });
    }
    if (request.method === "DELETE" && url.pathname === "/public-settings") {
      this.publicSettings = null;
      await this.state.storage.delete(PUBLIC_SETTINGS_STORAGE_KEY);
      return json({ ok: true });
    }
    return json({ error: "Not found" }, { status: 404 });
  }

  private async readApiCacheToken() {
    if (this.apiCacheToken != null) return this.apiCacheToken;
    const stored = await this.state.storage.get<string>(API_CACHE_TOKEN_STORAGE_KEY);
    if (typeof stored === "string") {
      this.apiCacheToken = stored;
      return stored;
    }
    const token = await readApiCacheTokenFromD1(this.env.DB);
    this.apiCacheToken = token;
    await this.state.storage.put(API_CACHE_TOKEN_STORAGE_KEY, token).catch(() => undefined);
    return token;
  }

  private async bumpApiCacheToken() {
    const token = createApiCacheToken();
    this.apiCacheToken = token;
    await this.state.storage.put(API_CACHE_TOKEN_STORAGE_KEY, token);
    await writeApiCacheTokenToD1(this.env.DB, token).catch(() => undefined);
    return token;
  }

  private async readPublicSettings(cacheVersion: number) {
    if (this.publicSettings?.cache_version === cacheVersion) return this.publicSettings;
    const entry = await this.state.storage.get<PublicSettingsCacheEntry>(PUBLIC_SETTINGS_STORAGE_KEY);
    if (entry?.cache_version === cacheVersion) {
      this.publicSettings = entry;
      return entry;
    }
    return null;
  }

  private async writePublicSettings(cacheVersion: number, settings: unknown) {
    const entry = { cache_version: cacheVersion, settings, updated_at: now() };
    this.publicSettings = entry;
    await this.state.storage.put(PUBLIC_SETTINGS_STORAGE_KEY, entry);
  }
}
