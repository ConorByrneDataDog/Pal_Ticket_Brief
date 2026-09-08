import { unsealCookiePayload } from "@/lib/cookieSeal";
import { normalizeSupportdogDatacenter, SUPPORTDOG_DATACENTERS } from "@/lib/supportdogDatacenter";
import { getSupportdogMcpAuthorizationFromEnv } from "@/lib/supportdogMcpClient";
import {
  entryFromSessionPayload,
  readSupportdogSessionsMap,
  supportdogOAuthCookieSecret,
} from "@/lib/supportdogOAuthSession";

const SESSION_EXPIRY_SKEW_MS = 60_000;

/**
 * A session entry only counts as "still signed in" if it has a refresh/access token
 * AND that token's own exp hasn't passed — matching listSupportdogSignedInDatacenters'
 * definition of "signed in", so connect-all and the status display never disagree.
 * @param {{ rt?: string, exp?: number } | undefined} entry
 */
export function isSessionStillValid(entry) {
  if (!entry?.rt) return false;
  if (!entry.exp) return true;
  return Date.now() < entry.exp - SESSION_EXPIRY_SKEW_MS;
}

/**
 * Next datacenter that still needs OAuth (env token counts as satisfied).
 * @param {Record<string, { rt?: string, exp?: number }>} sessionsMap
 */
export function nextSupportdogDatacenterNeedingAuth(sessionsMap) {
  for (const dc of SUPPORTDOG_DATACENTERS) {
    if (dc === "STAGING") continue;
    if (getSupportdogMcpAuthorizationFromEnv(dc)) continue;
    if (isSessionStillValid(sessionsMap[dc])) continue;
    return dc;
  }
  return null;
}

/**
 * After OAuth callback: merge new region into map from request + fresh seal, return next DC for connect-all.
 * @param {Request} request
 * @param {string | null | undefined} datacenter
 * @param {string} sessionSeal
 */
export function nextDcAfterOAuthExchange(request, datacenter, sessionSeal) {
  const map = readSupportdogSessionsMap(request);
  const dc = normalizeSupportdogDatacenter(datacenter);
  const secret = supportdogOAuthCookieSecret();
  if (secret && sessionSeal && dc) {
    const payload = unsealCookiePayload(sessionSeal, secret);
    const entry = entryFromSessionPayload(payload);
    if (entry?.rt) map[dc] = entry;
  }
  return nextSupportdogDatacenterNeedingAuth(map);
}
