import { NextResponse } from "next/server";
import { loadAccountDocs } from "@/lib/palAccountDocStore";
import { isGoogleDocsConfigured } from "@/lib/googleDocsClient";
import { readGoogleSession } from "@/lib/googleOAuthSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const configured = isGoogleDocsConfigured();
  const session = configured ? readGoogleSession(request) : null;
  return NextResponse.json({
    configured,
    signedIn: Boolean(session?.rt),
    email: session?.email || null,
    docs: loadAccountDocs(),
  });
}
