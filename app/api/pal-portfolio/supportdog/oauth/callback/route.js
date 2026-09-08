import { NextResponse } from "next/server";
import { isSessionStillValid, nextSupportdogDatacenterNeedingAuth } from "@/lib/supportdogConnectAll";
import { supportdogOAuthExchangeForCode } from "@/lib/supportdogOAuthDcr";
import {
  SUPPORTDOG_DCR_COOKIE,
  clearSupportdogOAuthCookies,
  clearSupportdogPkceCookie,
  mergeSupportdogSessionSealIntoMap,
  persistSupportdogSessionsMap,
  readSupportdogPkce,
} from "@/lib/supportdogOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description") || "";

  if (err) {
    const isRedirect = err === "invalid_redirect_uri" || /redirect_uri/i.test(errDesc);
    const hint = isRedirect
      ? "Clear SupportDog OAuth cookies and sign in again (port must match the app URL, e.g. :5101)."
      : "";
    const res = NextResponse.redirect(
      `${origin}/?supportdog_oauth_error=${encodeURIComponent(err + (errDesc ? `: ${errDesc}` : "") + (hint ? ` — ${hint}` : ""))}`
    );
    clearSupportdogOAuthCookies(res);
    if (isRedirect) {
      res.cookies.set(SUPPORTDOG_DCR_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    }
    return res;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    const res = NextResponse.redirect(`${origin}/?supportdog_oauth_error=missing_code_or_state`);
    clearSupportdogOAuthCookies(res);
    return res;
  }

  const pkce = readSupportdogPkce(request);
  if (!pkce || pkce.state !== state) {
    const res = NextResponse.redirect(`${origin}/?supportdog_oauth_error=state_mismatch`);
    clearSupportdogOAuthCookies(res);
    return res;
  }

  const exchanged = await supportdogOAuthExchangeForCode(request, code, pkce);
  if ("error" in exchanged) {
    const res = NextResponse.redirect(
      `${origin}/?supportdog_oauth_error=${encodeURIComponent(exchanged.error)}`
    );
    clearSupportdogOAuthCookies(res);
    return res;
  }

  let returnTo = pkce.returnTo || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const sessionsMap = mergeSupportdogSessionSealIntoMap(
    request,
    exchanged.datacenter,
    exchanged.sessionSeal
  );
  const doneDcs = Object.keys(sessionsMap).filter((dc) => isSessionStillValid(sessionsMap[dc]));

  const returnUrl = new URL(returnTo, origin);
  returnUrl.searchParams.set("supportdog_oauth", "ok");
  returnUrl.searchParams.set("supportdog_dc", exchanged.datacenter || pkce.datacenter);
  let redirectTarget = returnUrl.toString();

  if (pkce.connectAll) {
    const nextDc = nextSupportdogDatacenterNeedingAuth(sessionsMap);
    if (nextDc) {
      const connecting = new URL("/connecting", origin);
      connecting.searchParams.set("dc", nextDc);
      connecting.searchParams.set("done", doneDcs.join(","));
      connecting.searchParams.set("returnTo", returnTo);
      redirectTarget = connecting.toString();
    }
  }

  const res = NextResponse.redirect(redirectTarget);
  persistSupportdogSessionsMap(res, sessionsMap);
  clearSupportdogPkceCookie(res);
  return res;
}
