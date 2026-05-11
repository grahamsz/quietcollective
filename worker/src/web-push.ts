import { base64Url, base64UrlToBytes } from "./crypto";
import type { Env } from "./types";

const VAPID_EXPIRATION_SECONDS = 12 * 60 * 60;
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_VAPID_SUBJECT = "mailto:notifications@quietcollective.local";

let cachedKeyPairId = "";
let cachedPrivateKey: CryptoKey | null = null;

export type PushSubscriptionTarget = {
  endpoint: string;
  p256dh?: string;
  auth?: string;
};

export type WebPushResult = {
  ok: boolean;
  skipped?: boolean;
  gone?: boolean;
  status?: number;
};

export function webPushConfigured(env: Env) {
  return !!(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim());
}

function jsonBase64Url(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function validateVapidPublicKey(publicKey: string) {
  const bytes = base64UrlToBytes(publicKey);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 public key");
  return bytes;
}

function validateVapidPrivateKey(privateKey: string) {
  const bytes = base64UrlToBytes(privateKey);
  if (bytes.length !== 32) throw new Error("VAPID_PRIVATE_KEY must be a raw P-256 private scalar");
  return bytes;
}

async function importVapidPrivateKey(publicKey: string, privateKey: string) {
  const keyPairId = `${publicKey}.${privateKey}`;
  if (cachedPrivateKey && cachedKeyPairId === keyPairId) return cachedPrivateKey;

  const publicBytes = validateVapidPublicKey(publicKey);
  const privateBytes = validateVapidPrivateKey(privateKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64Url(publicBytes.slice(1, 33)),
    y: base64Url(publicBytes.slice(33, 65)),
    d: base64Url(privateBytes),
    ext: false,
  };
  cachedPrivateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  cachedKeyPairId = keyPairId;
  return cachedPrivateKey;
}

async function createVapidJwt(env: Env, audience: string) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT;
  const signingKey = await importVapidPrivateKey(publicKey, privateKey);
  const header = jsonBase64Url({ typ: "JWT", alg: "ES256" });
  const payload = jsonBase64Url({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + VAPID_EXPIRATION_SECONDS,
    sub: subject,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    new TextEncoder().encode(unsignedToken),
  );
  return `${unsignedToken}.${base64Url(signature)}`;
}

function pushAudience(endpoint: string) {
  const url = new URL(endpoint);
  return url.origin;
}

export async function sendWebPushTickle(env: Env, subscription: PushSubscriptionTarget): Promise<WebPushResult> {
  if (!webPushConfigured(env)) return { ok: false, skipped: true };
  const endpoint = subscription.endpoint.trim();
  const vapidPublicKey = env.VAPID_PUBLIC_KEY!.trim();
  const jwt = await createVapidJwt(env, pushAudience(endpoint));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
      TTL: String(PUSH_TTL_SECONDS),
      Urgency: "high",
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
  };
}
