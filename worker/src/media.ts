import type { Env } from "./types";
import { base64Url, base64UrlToString, getSecret, sign } from "./crypto";
import { parseJson } from "./utils";

export type SignedMediaPayload = {
  key: string;
  content_type?: string | null;
  variant: string;
  filename?: string | null;
  exp: number;
};

export async function signedMediaUrl(
  env: Env,
  key: string | null | undefined,
  contentType: string | null | undefined,
  variant: string,
  filename?: string | null,
) {
  if (!key) return null;
  const secret = getSecret(env);
  if (!secret) return null;
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const ttlHours = variant === "original" ? 2 : 8;
  const payload: SignedMediaPayload = {
    key,
    content_type: contentType || null,
    variant,
    filename: filename || null,
    exp: (hourBucket + ttlHours) * 60 * 60,
  };
  const data = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `/api/media/signed/${data}.${await sign(data, secret)}`;
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
