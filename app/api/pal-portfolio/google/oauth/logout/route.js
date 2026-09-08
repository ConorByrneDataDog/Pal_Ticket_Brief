import { NextResponse } from "next/server";
import { clearGoogleSessionCookie } from "@/lib/googleOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  let returnTo = url.searchParams.get("returnTo") || "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";
  const res = NextResponse.redirect(new URL(returnTo, url.origin));
  clearGoogleSessionCookie(res);
  return res;
}
