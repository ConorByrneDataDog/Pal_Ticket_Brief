import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function isGoogleOAuthClientConfigured() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
}

/**
 * @param {string} redirectUri
 */
export function buildGoogleOAuthClient(redirectUri) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured.");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * @param {string} redirectUri
 * @param {string} state
 */
export function googleOAuthAuthorizeUrl(redirectUri, state) {
  const client = buildGoogleOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

/**
 * Build a redirect URI matching the current request's origin.
 * @param {Request} request
 */
export function googleOAuthRedirectUriFromRequest(request) {
  const url = new URL(request.url);
  return `${url.origin}/api/pal-portfolio/google/oauth/callback`;
}

/**
 * Exchange an authorization code for tokens + the signed-in user's email.
 * @param {string} redirectUri
 * @param {string} code
 */
export async function exchangeGoogleOAuthCode(redirectUri, code) {
  const client = buildGoogleOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const info = await oauth2.userinfo.get();
    email = info.data.email || undefined;
  } catch {
    /* non-fatal — email is only used for display */
  }
  return { tokens, email };
}

/**
 * Build authenticated Docs/Drive clients from a stored refresh token, refreshing
 * the access token if needed. Returns the (possibly refreshed) token response too,
 * so the caller can re-seal the session cookie.
 *
 * @param {string} refreshToken
 * @param {string} redirectUri
 */
export async function googleClientsFromRefreshToken(refreshToken, redirectUri) {
  const client = buildGoogleOAuthClient(redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  client.setCredentials(credentials);
  return {
    docs: google.docs({ version: "v1", auth: client }),
    drive: google.drive({ version: "v3", auth: client }),
    tokenResponse: credentials,
  };
}
