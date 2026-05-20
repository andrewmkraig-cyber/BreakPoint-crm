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

// Shown only when the token is GENUINELY expired (a real reconnect
// fixes it). The interview scheduler matches the trailing "Reconnect in
// Settings" substring to render a link, so keep that phrase stable.
export const TEAMS_TOKEN_EXPIRED_MESSAGE =
  "Microsoft Teams token expired. Reconnect in Settings > Connectors.";

// Shown when the token is valid but Graph refuses to create the meeting
// (missing OnlineMeetings.ReadWrite consent or no Teams license). This is
// NOT an expiry, so reconnecting will not help; the recruiter needs an
// admin fix or should fall back to Google Meet.
export const TEAMS_NOT_AUTHORIZED_MESSAGE =
  "Teams meeting creation is not authorized. The Azure app may be missing OnlineMeetings.ReadWrite permission. Contact your admin or use Google Meet instead.";

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

// Canonical "is the access token itself still valid" probe. GET /me is
// the identity endpoint: a 200 means the token is good (even if a
// specific resource like onlineMeetings is forbidden for permission
// reasons), and only a 401 means the token is genuinely expired/revoked.
// Anything else (403, 5xx, network) is "unknown" so we never declare
// expiry on ambiguous signals.
async function probeIdentity(accessToken: string): Promise<"alive" | "expired" | "unknown"> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH_ROOT}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return "unknown";
  }
  if (res.status === 200) return "alive";
  if (res.status === 401) return "expired";
  return "unknown";
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

    // 400 (AuthenticationError "Error authenticating with resource") and
    // 403 (Forbidden) mean the token authenticated fine but the app or
    // account is not authorized to create online meetings: missing
    // OnlineMeetings.ReadWrite consent or no Teams license. This is NOT an
    // expired token, so do not flag the connection expired.
    if (res.status === 400 || res.status === 403) {
      throw new MicrosoftGraphError(TEAMS_NOT_AUTHORIZED_MESSAGE, res.status);
    }

    // A 401 means the bearer token was rejected. Confirm against the
    // identity endpoint before declaring expiry: only a genuinely dead
    // token (GET /me also 401) flips the connection to expired. If /me
    // still works, this is a resource-authorization issue, not expiry.
    if (res.status === 401) {
      const identity = await probeIdentity(accessToken);
      if (identity === "expired") {
        await markExpired(args.organizationId);
        throw new MicrosoftGraphError(TEAMS_TOKEN_EXPIRED_MESSAGE, 401);
      }
      throw new MicrosoftGraphError(TEAMS_NOT_AUTHORIZED_MESSAGE, 401);
    }

    throw new MicrosoftGraphError(
      "Couldn't create the Teams meeting. Try again, or use Google Meet instead.",
      res.status,
    );
  }

  const json = (await res.json()) as GraphOnlineMeetingResponse;
  if (!json.joinWebUrl) {
    throw new MicrosoftGraphError("Microsoft Graph response missing joinWebUrl.");
  }
  return { joinWebUrl: json.joinWebUrl, meetingId: json.id };
}

export type MicrosoftHealth = "connected" | "expired" | "disconnected";

// Canonical connection-health check for the Settings connector card.
// Validity is judged by GET /me and the refresh grant, NOT by whether a
// specific resource like onlineMeetings is authorized: a token that
// passes /me but can't create Teams meetings (missing permission) is
// still CONNECTED. The card only goes amber when the token is genuinely
// dead.
export async function checkMicrosoftHealth(organizationId: string): Promise<MicrosoftHealth> {
  const token = await prisma.microsoftToken.findUnique({
    where: { organizationId },
    select: { status: true },
  });
  if (!token) return "disconnected";
  // A prior refresh-grant failure or confirmed /me 401 already flagged the
  // row; honor it until the recruiter reconnects.
  if (token.status === "expired") return "expired";

  let accessToken: string | null;
  try {
    accessToken = await getMicrosoftToken(organizationId);
  } catch {
    // Transient refresh failure (5xx / network): trust the last known
    // good state rather than nuking a healthy connection on a blip.
    return "connected";
  }
  // getMicrosoftToken returns null only when the refresh grant is dead
  // (it has already marked the row expired).
  if (accessToken === null) return "expired";

  const identity = await probeIdentity(accessToken);
  if (identity === "expired") {
    await markExpired(organizationId);
    return "expired";
  }
  // "alive" or "unknown" (403/5xx/network): keep the card green.
  return "connected";
}

export { MicrosoftGraphError };
