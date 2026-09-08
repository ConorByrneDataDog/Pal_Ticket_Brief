import { NextResponse } from "next/server";
import { exchangeGoogleOAuthCode, googleOAuthRedirectUriFromRequest } from "@/lib/googleOAuthClient";
import {
  attachGoogleSessionCookie,
  clearGoogleOAuthStateCookie,
  readGoogleOAuthStateCookie,
} from "@/lib/googleOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const err = url.searchParams.get("error");
  if (err) {
    const res = NextResponse.redirect(`${origin}/?google_oauth_error=${encodeURIComponent(err)}`);
    clearGoogleOAuthStateCookie(res);
    return res;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    const res = NextResponse.redirect(`${origin}/?google_oauth_error=missing_code_or_state`);
    clearGoogleOAuthStateCookie(res);
    return res;
  }

  const stateCookie = readGoogleOAuthStateCookie(request);
  if (!stateCookie || stateCookie.state !== state) {
    const res = NextResponse.redirect(`${origin}/?google_oauth_error=state_mismatch`);
    clearGoogleOAuthStateCookie(res);
    return res;
  }

  let exchanged;
  try {
    exchanged = await exchangeGoogleOAuthCode(googleOAuthRedirectUriFromRequest(request), code);
  } catch (e) {
    const res = NextResponse.redirect(
      `${origin}/?google_oauth_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`
    );
    clearGoogleOAuthStateCookie(res);
    return res;
  }

  let returnTo = stateCookie.returnTo || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";
  const returnUrl = new URL(returnTo, origin);
  returnUrl.searchParams.set("google_oauth", "ok");

  const res = NextResponse.redirect(returnUrl.toString());
  attachGoogleSessionCookie(res, exchanged.tokens, "", exchanged.email);
  clearGoogleOAuthStateCookie(res);
  return res;
}
