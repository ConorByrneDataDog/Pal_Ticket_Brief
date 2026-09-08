import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Generic AES-256-GCM cookie sealing helpers shared by SupportDog OAuth session/cookie code.
 * (Previously lived in `lib/gleanOAuthSession.js` — extracted so it has no Glean dependency.)
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;

/** @returns {Buffer} */
function deriveKey(secret) {
  return createHash("sha256").update(String(secret), "utf8").digest();
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} secret
 */
export function sealCookiePayload(payload, secret) {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
  const json = JSON.stringify(payload);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

/**
 * @param {string} b64url
 * @param {string} secret
 * @returns {Record<string, unknown> | null}
 */
export function unsealCookiePayload(b64url, secret) {
  try {
    const buf = Buffer.from(b64url, "base64url");
    if (buf.length < IV_LEN + AUTH_TAG_LEN + 2) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
    const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
    const key = deriveKey(secret);
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: AUTH_TAG_LEN });
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const o = JSON.parse(dec);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} tok
 * @param {string} tok.access_token
 * @param {string} [tok.refresh_token]
 * @param {number} [tok.expires_in]
 * @param {string} existingRt
 */
export function buildSessionPayloadFromTokenResponse(tok, existingRt) {
  const access_token = typeof tok.access_token === "string" ? tok.access_token : "";
  const refresh_token = typeof tok.refresh_token === "string" && tok.refresh_token ? tok.refresh_token : existingRt;
  const expires_in = typeof tok.expires_in === "number" ? tok.expires_in : 3600;
  const exp = Date.now() + Math.max(60, expires_in) * 1000;
  return { v: 1, rt: refresh_token, at: access_token, exp };
}

/**
 * Shared cookie options for httpOnly session/PKCE cookies.
 */
export function cookieBaseOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  };
}
