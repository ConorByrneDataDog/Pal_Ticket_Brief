import { googleClientsFromRefreshToken, googleOAuthRedirectUriFromRequest, isGoogleOAuthClientConfigured } from "@/lib/googleOAuthClient";
import { isGoogleOAuthSessionConfigured, readGoogleSession } from "@/lib/googleOAuthSession";

export function isGoogleDocsConfigured() {
  return isGoogleOAuthSessionConfigured() && isGoogleOAuthClientConfigured();
}

/**
 * Build authenticated Docs/Drive clients for the signed-in user making this request.
 * Throws a descriptive error if the user hasn't connected Google yet.
 *
 * @param {Request} request
 * @returns {Promise<{ docs: import("googleapis").docs_v1.Docs, drive: import("googleapis").drive_v3.Drive, session: { rt: string, email?: string }, tokenResponse: object }>}
 */
export async function getGoogleClientsForRequest(request) {
  if (!isGoogleDocsConfigured()) {
    throw new Error("Google Docs export is not configured (missing OAuth client id/secret or cookie secret).");
  }
  const session = readGoogleSession(request);
  if (!session?.rt) {
    throw new Error("Not signed in to Google. Use \"Connect Google\" first.");
  }
  const redirectUri = googleOAuthRedirectUriFromRequest(request);
  const { docs, drive, tokenResponse } = await googleClientsFromRefreshToken(session.rt, redirectUri);
  return { docs, drive, session, tokenResponse };
}
