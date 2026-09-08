import { buildSessionPayloadFromTokenResponse, cookieBaseOptions, sealCookiePayload, unsealCookiePayload } from "@/lib/cookieSeal";

export const GOOGLE_SESSION_COOKIE = "pp_google_oauth_sess";
export const GOOGLE_PKCE_COOKIE = "pp_google_oauth_state";

export function googleOAuthCookieSecret() {
  return (
    process.env.GOOGLE_OAUTH_COOKIE_SECRET?.trim() ||
    process.env.SUPPORTDOG_OAUTH_COOKIE_SECRET?.trim() ||
    ""
  );
}

export function isGoogleOAuthSessionConfigured() {
  return googleOAuthCookieSecret().length >= 16;
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return trimmed.slice(prefix.length);
      }
    }
  }
  return null;
}

/**
 * @param {Request | null | undefined} request
 * @returns {{ rt: string, at: string, exp: number, email?: string } | null}
 */
export function readGoogleSession(request) {
  const secret = googleOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request?.headers?.get("cookie") || "", GOOGLE_SESSION_COOKIE);
  if (!raw) return null;
  const payload = unsealCookiePayload(raw, secret);
  if (!payload || typeof payload.rt !== "string" || !payload.rt) return null;
  return {
    rt: payload.rt,
    at: typeof payload.at === "string" ? payload.at : "",
    exp: typeof payload.exp === "number" ? payload.exp : 0,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

/**
 * @param {import("next/server").NextResponse} res
 * @param {{ access_token: string, refresh_token?: string, expires_in?: number }} tokenResponse
 * @param {string} existingRefreshToken
 * @param {string} [email]
 */
export function attachGoogleSessionCookie(res, tokenResponse, existingRefreshToken, email) {
  const secret = googleOAuthCookieSecret();
  const base = buildSessionPayloadFromTokenResponse(tokenResponse, existingRefreshToken);
  const seal = sealCookiePayload({ ...base, email }, secret);
  res.cookies.set(GOOGLE_SESSION_COOKIE, seal, { ...cookieBaseOptions(), maxAge: 60 * 60 * 24 * 30 });
}

/**
 * @param {import("next/server").NextResponse} res
 */
export function clearGoogleSessionCookie(res) {
  res.cookies.set(GOOGLE_SESSION_COOKIE, "", { ...cookieBaseOptions(), maxAge: 0 });
}

/**
 * @param {import("next/server").NextResponse} res
 * @param {{ state: string, returnTo: string }} payload
 */
export function attachGoogleOAuthStateCookie(res, payload) {
  const secret = googleOAuthCookieSecret();
  res.cookies.set(GOOGLE_PKCE_COOKIE, sealCookiePayload(payload, secret), { ...cookieBaseOptions(), maxAge: 600 });
}

/**
 * @param {Request | null | undefined} request
 */
export function readGoogleOAuthStateCookie(request) {
  const secret = googleOAuthCookieSecret();
  if (!secret) return null;
  const raw = getCookieValue(request?.headers?.get("cookie") || "", GOOGLE_PKCE_COOKIE);
  if (!raw) return null;
  const o = unsealCookiePayload(raw, secret);
  if (!o || typeof o.state !== "string") return null;
  return { state: o.state, returnTo: typeof o.returnTo === "string" ? o.returnTo : "/" };
}

/**
 * @param {import("next/server").NextResponse} res
 */
export function clearGoogleOAuthStateCookie(res) {
  res.cookies.set(GOOGLE_PKCE_COOKIE, "", { ...cookieBaseOptions(), maxAge: 0 });
}
