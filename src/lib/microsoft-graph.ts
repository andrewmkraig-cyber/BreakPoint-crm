import { prisma } from "@/lib/prisma";

// Server-side helper for Microsoft Graph calls. The tokens are stored
// per-org in MicrosoftToken (one row per Organization). Recruiters
// connect once from Settings → Connectors and the org-level token is
// reused for every interview scheduled on behalf of that org.

const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

// Refresh roughly a minute before the stored expiry so a long-running
// scheduleInterview call doesn't race a token that expires mid-request.
const EXPIRY_SKEW_MS = 60_000;

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

export async function getValidAccessToken(organizationId: string): Promise<string> {
  const token = await prisma.microsoftToken.findUnique({
    where: { organizationId },
  });
  if (!token) {
    throw new MicrosoftGraphError("Microsoft account is not connected for this organization.");
  }

  if (token.expiresAt.getTime() > Date.now() + EXPIRY_SKEW_MS) {
    return token.accessToken;
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
    throw new MicrosoftGraphError(
      `Microsoft token refresh failed (${res.status}): ${text || "no body"}`,
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
  const accessToken = await getValidAccessToken(args.organizationId);

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
    throw new MicrosoftGraphError(
      `Microsoft Graph onlineMeetings create failed (${res.status}): ${text || "no body"}`,
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
