import { NextResponse } from "next/server";
import { isGoogleOAuthClientConfigured } from "@/lib/googleOAuthClient";
import { isGoogleOAuthSessionConfigured, readGoogleSession } from "@/lib/googleOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const configured = isGoogleOAuthSessionConfigured() && isGoogleOAuthClientConfigured();
  const session = configured ? readGoogleSession(request) : null;
  return NextResponse.json({
    configured,
    signedIn: Boolean(session?.rt),
    email: session?.email || null,
  });
}
