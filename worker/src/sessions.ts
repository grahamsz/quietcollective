import type { AuthenticatedUser, Env, Role } from "./types";
import { base64Url, base64UrlToString, getSecret, sign } from "./crypto";

export const SESSION_CLAIMS_VERSION = 2;
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_REVALIDATE_AFTER_SECONDS = 10 * 60;

type SessionUser = Pick<AuthenticatedUser, "id" | "role" | "password_changed_at" | "force_password_change_at">;

export type SessionClaims = {
  v: typeof SESSION_CLAIMS_VERSION;
  uid: string;
  role: Role;
  pwd: string | null;
  fpc: string | null;
  iat: number;
  exp: number;
  vat: number;
};

export type ReadSessionResult = {
  kind: "claims";
  claims: SessionClaims;
  expiresAt: number;
  stale: boolean;
} | {
  kind: "legacy";
  userId: string;
  expiresAt: number;
  stale: true;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function role(value: unknown): Role | null {
  return value === "admin" || value === "member" ? value : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function validTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function claimsFromUnknown(value: unknown): SessionClaims | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const claimRole = role(raw.role);
  const uid = typeof raw.uid === "string" ? raw.uid : "";
  const iat = validTimestamp(raw.iat);
  const exp = validTimestamp(raw.exp);
  const vat = validTimestamp(raw.vat);
  if (raw.v !== SESSION_CLAIMS_VERSION || !uid || !claimRole || !iat || !exp || !vat) return null;
  return {
    v: SESSION_CLAIMS_VERSION,
    uid,
    role: claimRole,
    pwd: nullableString(raw.pwd),
    fpc: nullableString(raw.fpc),
    iat,
    exp,
    vat,
  };
}

export function userFromSessionClaims(claims: SessionClaims): AuthenticatedUser {
  return {
    id: claims.uid,
    role: claims.role,
    disabled_at: null,
    password_changed_at: claims.pwd,
    force_password_change_at: claims.fpc,
  };
}

export async function createSession(user: SessionUser, env: Env, options: { expiresAt?: number; issuedAt?: number; verifiedAt?: number } = {}) {
  const secret = getSecret(env);
  if (!secret) throw new Error("Server authentication is not configured");
  const issuedAt = options.issuedAt || nowSeconds();
  const expiresAt = options.expiresAt || issuedAt + SESSION_DURATION_SECONDS;
  const claims: SessionClaims = {
    v: SESSION_CLAIMS_VERSION,
    uid: user.id,
    role: user.role,
    pwd: user.password_changed_at || null,
    fpc: user.force_password_change_at || null,
    iat: issuedAt,
    exp: expiresAt,
    vat: options.verifiedAt || issuedAt,
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const payload = `v2.${encoded}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function readSession(token: string, env: Env): Promise<ReadSessionResult | null> {
  const secret = getSecret(env);
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length === 3 && parts[0] === "v2") {
    const payload = parts.slice(0, 2).join(".");
    const expected = await sign(payload, secret);
    if (expected !== parts[2]) return null;
    const parsed = (() => {
      try {
        return JSON.parse(base64UrlToString(parts[1]));
      } catch {
        return null;
      }
    })();
    const claims = claimsFromUnknown(parsed);
    if (!claims) return null;
    const now = nowSeconds();
    if (claims.exp < now) return null;
    return {
      kind: "claims",
      claims,
      expiresAt: claims.exp,
      stale: now - Math.min(claims.vat, now) >= SESSION_REVALIDATE_AFTER_SECONDS,
    };
  }
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = await sign(payload, secret);
  if (expected !== parts[3]) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds()) return null;
  return { kind: "legacy", userId: parts[0], expiresAt, stale: true };
}

export async function readSessionUserId(token: string, env: Env) {
  const session = await readSession(token, env);
  if (!session) return null;
  return session.kind === "legacy" ? session.userId : session.claims.uid;
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

export function sessionCookie(token: string, expiresAt?: number) {
  const maxAge = expiresAt ? Math.max(0, expiresAt - nowSeconds()) : SESSION_DURATION_SECONDS;
  return `qc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function expiredSessionCookie() {
  return "qc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
