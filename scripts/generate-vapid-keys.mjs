import { generateKeyPairSync } from "node:crypto";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function leftPad(value, byteLength) {
  if (value.length > byteLength) throw new Error(`Expected at most ${byteLength} bytes`);
  if (value.length === byteLength) return value;
  return Buffer.concat([Buffer.alloc(byteLength - value.length), value]);
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });
const x = leftPad(Buffer.from(publicJwk.x, "base64url"), 32);
const y = leftPad(Buffer.from(publicJwk.y, "base64url"), 32);
const d = Buffer.from(privateJwk.d, "base64url");
const publicBytes = Buffer.concat([Buffer.from([4]), x, y]);

console.log(JSON.stringify({
  VAPID_PUBLIC_KEY: base64Url(publicBytes),
  VAPID_PRIVATE_KEY: base64Url(leftPad(d, 32)),
  VAPID_SUBJECT: "mailto:notifications@example.com",
}, null, 2));
