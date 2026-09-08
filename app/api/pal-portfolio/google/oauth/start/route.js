import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { googleOAuthAuthorizeUrl, googleOAuthRedirectUriFromRequest, isGoogleOAuthClientConfigured } from "@/lib/googleOAuthClient";
import { attachGoogleOAuthStateCookie, isGoogleOAuthSessionConfigured } from "@/lib/googleOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!isGoogleOAuthSessionConfigured()) {
    return NextResponse.json(
      { error: "Set GOOGLE_OAUTH_COOKIE_SECRET (or SUPPORTDOG_OAUTH_COOKIE_SECRET) in .env.local." },
      { status: 503 }
    );
  }
  if (!isGoogleOAuthClientConfigured()) {
    return NextResponse.json(
      { error: "Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  let returnTo = url.searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  const redirectUri = googleOAuthRedirectUriFromRequest(request);
  const state = randomBytes(24).toString("base64url");

  try {
    const authorizeUrl = googleOAuthAuthorizeUrl(redirectUri, state);
    const res = NextResponse.redirect(authorizeUrl);
    attachGoogleOAuthStateCookie(res, { state, returnTo });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
