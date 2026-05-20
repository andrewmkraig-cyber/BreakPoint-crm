import { prisma } from "@/lib/prisma";

// Server-side helper for Microsoft Graph calls. The tokens are stored
// per-org in MicrosoftToken (one row per Organization). Recruiters
// connect once from Settings → Connectors and the org-level token is
// reused for every interview scheduled on behalf of that org.

const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

// Treat a token as needing refresh once it is within 5 minutes of its
// stored expiry, so a long-running scheduleInterview call never races a
// token that expires mid-request.
const EXPIRY_SKEW_MS = 5 * 60_000;

// Exact copy surfaced to the recruiter wherever a Teams token has gone
// bad. The interview scheduler matches the trailing "Reconnect in
// Settings" substring to render a link, so keep that phrase stable.
export const TEAMS_TOKEN_EXPIRED_MESSAGE =
  "Microsoft Teams token expired. Reconnect in Settings > Connectors.";

type GraphTokenRefreshResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type GraphOnlineMeetingResponse = {
  id: string;
  joinWebUrl: string;
};

class MicrosoftGraphError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "MicrosoftGraphError";
  }
}

// Flip the org's token row to "expired" so Settings > Connectors shows
// the amber reconnect banner and the scheduler stops offering Teams.
// Best-effort: a write failure here must not mask the original auth
// failure the caller is already handling.
async function markExpired(organizationId: string): Promise<void> {
  await prisma.microsoftToken
    .update({ where: { organizationId }, data: { status: "expired" } })
    .catch(() => {});
}

// True when a Graph response means the token is no longer usable and the
// recruiter must reconnect. 401/403 are always auth failures; a 400 only
// counts when the body names an authentication problem (Graph returns
// 400 "AuthenticationError" / "InvalidAuthenticationToken" for a token
// that expired server-side after passing our local expiry check).
function isGraphAuthError(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status === 400) {
    return /authenticat|invalidauthenticationtoken|token.*(expir|invalid)|invalid_grant/i.test(body);
  }
  return false;
}

// Returns a usable Graph access token for the org, or null when the
// connection can't be used (no token row, or the refresh grant has been
// revoked/expired). On a dead refresh the row is marked "expired" so the
// UI can prompt a reconnect. Throws only on server misconfiguration
// (missing OAuth env vars) or a transient/non-auth refresh failure that
// a retry might clear, which are not "the user must reconnect" states.
export async function getMicrosoftToken(organizationId: string): Promise<string | null> {
  const token = await prisma.microsoftToken.findUnique({
    where: { organizationId },
  });
  if (!token) return null;

  if (token.expiresAt.getTime() > Date.now() + EXPIRY_SKEW_MS) {
    return token.accessToken;
  }

  // offline_access guarantees a refresh token at connect time, so an
  // empty one means the connection is unusable and needs a reconnect.
  if (!token.refreshToken) {
    await markExpired(organizationId);
    return null;
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new MicrosoftGraphError("Microsoft OAuth env vars not configured on the server.");
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", token.refreshToken);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[teams] token refresh failed (${res.status}): ${text || "no body"}`);
    // invalid_grant (or any 4xx) means the refresh token itself is dead.
    // The only fix is a fresh OAuth consent, so mark expired and return
    // null. A 5xx is Microsoft-side and transient; surface a clean error
    // so we don't false-flag a healthy connection as expired (and never
    // leak the raw Microsoft body to the recruiter).
    if (res.status >= 400 && res.status < 500) {
      await markExpired(organizationId);
      return null;
    }
    throw new MicrosoftGraphError(
      `Microsoft token refresh failed (${res.status}).`,
      res.status,
    );
  }

  const refreshed = (await res.json()) as GraphTokenRefreshResponse;
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

  await prisma.microsoftToken.update({
    where: { organizationId },
    data: {
      accessToken: refreshed.access_token,
      // Microsoft sometimes rotates the refresh token on use, sometimes
      // not. Persist the new one when present; keep the old otherwise.
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      expiresAt,
      // Deliberately do NOT clear an "expired" flag here. A working
      // refresh only proves the OAuth grant is alive, not that Graph will
      // accept the token for onlineMeetings (the AuthenticationError case
      // Andrew hit returns a valid token that Teams still rejects). If we
      // flipped back to "connected" on every hourly refresh, the connector
      // card would falsely show green again. Only an explicit reconnect
      // (the OAuth callback) clears the expired flag.
    },
  });

  return refreshed.access_token;
}

// Creates a standalone Teams meeting (no calendar event) and returns
// the join URL + meeting id. We deliberately use /me/onlineMeetings
// rather than POST /me/events because Ace already creates the
// organizer-only calendar event via Google Calendar for tracking; this
// keeps the existing Google-event audit trail intact while letting the
// Teams link replace the Google Meet link as the join target.
export async function createTeamsMeeting(args: {
  organizationId: string;
  startISO: string;
  endISO: string;
  subject: string;
}): Promise<{ joinWebUrl: string; meetingId: string }> {
  const accessToken = await getMicrosoftToken(args.organizationId);
  if (!accessToken) {
    throw new MicrosoftGraphError(TEAMS_TOKEN_EXPIRED_MESSAGE);
  }

  const res = await fetch(`${GRAPH_ROOT}/me/onlineMeetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDateTime: args.startISO,
      endDateTime: args.endISO,
      subject: args.subject,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Log the raw Graph body server-side for debugging, but never surface
    // it to the recruiter.
    console.error(`[teams] onlineMeetings create failed (${res.status}): ${text || "no body"}`);
    // Graph rejects a stale/revoked token with an auth-class error. 401
    // and 403 are always auth; a 400 "AuthenticationError" (token expired
    // server-side even though it passed our expiry check) is the case
    // Andrew hit. Treat all three as "reconnect required": flip the row to
    // expired and surface only the clean message.
    if (isGraphAuthError(res.status, text)) {
      await markExpired(args.organizationId);
      throw new MicrosoftGraphError(TEAMS_TOKEN_EXPIRED_MESSAGE, res.status);
    }
    throw new MicrosoftGraphError(
      "Couldn't create the Teams meeting. Try again, or reconnect Microsoft in Settings > Connectors.",
      res.status,
    );
  }

  const json = (await res.json()) as GraphOnlineMeetingResponse;
  if (!json.joinWebUrl) {
    throw new MicrosoftGraphError("Microsoft Graph response missing joinWebUrl.");
  }
  return { joinWebUrl: json.joinWebUrl, meetingId: json.id };
}

export { MicrosoftGraphError };
