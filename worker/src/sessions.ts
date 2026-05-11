import type { Env } from "./types";
import { base64Url, getSecret, sign } from "./crypto";

export async function createSession(userId: string, env: Env) {
  const secret = getSecret(env);
  if (!secret) throw new Error("Server authentication is not configured");
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${userId}.${expiresAt}.${nonce}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function readSessionUserId(token: string, env: Env) {
  const secret = getSecret(env);
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = await sign(payload, secret);
  if (expected !== parts[3]) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;
  return parts[0];
}

export function parseCookies(header: string | null | undefined) {
  const cookies = new Map<string, string>();
  for (const part of (header || "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

export function sessionCookie(token: string) {
  return `qc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`;
}

export function expiredSessionCookie() {
  return "qc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
