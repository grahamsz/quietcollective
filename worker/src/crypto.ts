import type { Env } from "./types";

export function getSecret(env: Env) {
  return env.JWT_SECRET || env.ADMIN_SETUP_TOKEN || "";
}

export function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlToString(value: string) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

export async function sha256(value: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptString(value: string, secret: string) {
  if (!secret) throw new Error("Encryption secret is not configured");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptString(value: string, secret: string) {
  if (!secret) throw new Error("Encryption secret is not configured");
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new Error("Invalid encrypted value");
  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(ivPart) }, key, base64UrlToBytes(cipherPart));
  return new TextDecoder().decode(plaintext);
}
