import type { Env } from "./types";
import { base64Url, base64UrlToString, getSecret, sign } from "./crypto";
import { parseJson } from "./utils";

const R2_S3_REGION = "auto";
const R2_S3_SERVICE = "s3";
const R2_S3_ALGORITHM = "AWS4-HMAC-SHA256";
const R2_S3_HOST_SUFFIX = "r2.cloudflarestorage.com";

export type SignedMediaPayload = {
  key: string;
  content_type?: string | null;
  variant: string;
  filename?: string | null;
  exp: number;
};

function ttlSecondsForVariant(variant: string) {
  return variant === "original" ? 2 * 60 * 60 : 8 * 60 * 60;
}

function mediaSigningDate() {
  const bucketMs = 60 * 60 * 1000;
  return new Date(Math.floor(Date.now() / bucketMs) * bucketMs);
}

function amzDateParts(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function hex(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...data].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeS3Path(value: string) {
  return value.split("/").map(encodeRfc3986).join("/");
}

function compareEncoded(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalQuery(params: Array<[string, string]>) {
  return params
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey === rightKey ? compareEncoded(leftValue, rightValue) : compareEncoded(leftKey, rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmacSha256(key: string | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? new TextEncoder().encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
}

async function r2SigningKey(secretAccessKey: string, dateStamp: string) {
  const dateKey = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmacSha256(dateKey, R2_S3_REGION);
  const serviceKey = await hmacSha256(regionKey, R2_S3_SERVICE);
  return hmacSha256(serviceKey, "aws4_request");
}

function cleanDispositionFilename(filename: string | null | undefined) {
  return (filename || "download").replace(/[\r\n"]/g, "").slice(0, 180) || "download";
}

export async function r2PresignedGetUrl(
  env: Env,
  key: string | null | undefined,
  contentType: string | null | undefined,
  variant: string,
  filename?: string | null,
) {
  if (!key) return null;
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) return null;

  const { amzDate, dateStamp } = amzDateParts(mediaSigningDate());
  const credentialScope = `${dateStamp}/${R2_S3_REGION}/${R2_S3_SERVICE}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;
  const host = `${accountId}.${R2_S3_HOST_SUFFIX}`;
  const canonicalUri = `/${encodeS3Path(bucketName)}/${encodeS3Path(key)}`;
  const params: Array<[string, string]> = [
    ["X-Amz-Algorithm", R2_S3_ALGORITHM],
    ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(ttlSecondsForVariant(variant))],
    ["X-Amz-SignedHeaders", "host"],
  ];
  if (contentType) params.push(["response-content-type", contentType]);
  if (variant === "original") params.push(["response-content-disposition", `attachment; filename="${cleanDispositionFilename(filename)}"`]);

  const queryWithoutSignature = canonicalQuery(params);
  const canonicalRequest = [
    "GET",
    canonicalUri,
    queryWithoutSignature,
    `host:${host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    R2_S3_ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await r2SigningKey(secretAccessKey, dateStamp);
  const signature = hex(await hmacSha256(signingKey, stringToSign));
  return `https://${host}${canonicalUri}?${queryWithoutSignature}&X-Amz-Signature=${signature}`;
}

export async function signedAppMediaUrl(
  env: Env,
  key: string | null | undefined,
  contentType: string | null | undefined,
  variant: string,
  filename?: string | null,
) {
  if (!key) return null;
  const secret = getSecret(env);
  if (!secret) return null;
  const exp = Math.floor(mediaSigningDate().getTime() / 1000) + ttlSecondsForVariant(variant);
  const payload: SignedMediaPayload = {
    key,
    content_type: contentType || null,
    variant,
    filename: filename || null,
    exp,
  };
  const data = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `/api/media/signed/${data}.${await sign(data, secret)}`;
}

export async function signedMediaUrl(
  env: Env,
  key: string | null | undefined,
  contentType: string | null | undefined,
  variant: string,
  filename?: string | null,
) {
  return await r2PresignedGetUrl(env, key, contentType, variant, filename) ||
    signedAppMediaUrl(env, key, contentType, variant, filename);
}

export async function readSignedMediaPayload(env: Env, token: string): Promise<SignedMediaPayload | null> {
  const secret = getSecret(env);
  if (!secret) return null;
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  if (await sign(data, secret) !== signature) return null;
  const payload = parseJson<SignedMediaPayload>(base64UrlToString(data), { key: "", variant: "", exp: 0 });
  if (!payload.key || !payload.variant || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
