import { prisma } from "@/lib/prisma";

// Google Calendar helpers. Reuses the same access-token refresh pattern as
// src/lib/gmail.ts so both APIs share the single Account row per user.
//
// The `https://www.googleapis.com/auth/calendar.events` scope is granted at
// sign-in (see src/lib/auth.ts). Users signed in before the scope was added
// will need to sign out and back in for calendar calls to succeed.

async function getFreshAccessToken(userId: string): Promise<string> {
  const acct = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
  if (!acct || !acct.refresh_token) {
    throw new Error(
      "No Google refresh token on file. Sign out and sign back in to grant Calendar permissions.",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (acct.access_token && acct.expires_at && acct.expires_at - now > 60) {
    return acct.access_token;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth env vars missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: acct.refresh_token,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const expiresAt = Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600);
  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: { access_token: json.access_token, expires_at: expiresAt },
  });
  return json.access_token;
}

export type CalendarAttendee = { email: string; displayName?: string };

export type CreateCalendarEventInput = {
  userId: string;
  summary: string;
  description?: string;
  startISO: string;
  durationMin: number;
  attendees?: CalendarAttendee[];
  // If true, Google creates a Meet conference and returns the link in the
  // response's conferenceData.entryPoints. Only meaningful for video interviews.
  createMeet?: boolean;
  // If false (default), Google will NOT email attendees when the event is
  // created. Used by the "Client Sending Invite" flow where the client is
  // sending their own invite and we just want the event on MY calendar.
  sendUpdates?: boolean;
  location?: string;
};

export type CreateCalendarEventResult = {
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
};

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CreateCalendarEventResult> {
  const accessToken = await getFreshAccessToken(input.userId);
  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + input.durationMin * 60 * 1000);
  const tz = "America/New_York";

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
  };
  if (input.attendees && input.attendees.length > 0) {
    body.attendees = input.attendees.map((a) => ({ email: a.email, displayName: a.displayName }));
  }
  if (input.location) body.location = input.location;
  if (input.createMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `ace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const sendUpdates = input.sendUpdates ? "all" : "none";
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("sendUpdates", sendUpdates);
  if (input.createMeet) url.searchParams.set("conferenceDataVersion", "1");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar create failed (${res.status}): ${text || "no body"}`);
  }
  const json = (await res.json()) as {
    id: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: {
      entryPoints?: { entryPointType?: string; uri?: string }[];
    };
  };
  const meetLink = (() => {
    if (json.hangoutLink) return json.hangoutLink;
    const ep = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
    return ep?.uri ?? null;
  })();
  return {
    eventId: json.id,
    htmlLink: json.htmlLink ?? null,
    meetLink,
  };
}

export async function updateCalendarEvent(params: {
  userId: string;
  eventId: string;
  startISO: string;
  durationMin: number;
  sendUpdates?: boolean;
}): Promise<void> {
  const accessToken = await getFreshAccessToken(params.userId);
  const start = new Date(params.startISO);
  const end = new Date(start.getTime() + params.durationMin * 60 * 1000);
  const tz = "America/New_York";
  const sendUpdates = params.sendUpdates ? "all" : "none";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  url.searchParams.set("sendUpdates", sendUpdates);
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar update failed (${res.status}): ${text || "no body"}`);
  }
}

export async function deleteCalendarEvent(params: {
  userId: string;
  eventId: string;
  sendUpdates?: boolean;
}): Promise<void> {
  const accessToken = await getFreshAccessToken(params.userId);
  const sendUpdates = params.sendUpdates ? "all" : "none";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
  );
  url.searchParams.set("sendUpdates", sendUpdates);
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar delete failed (${res.status}): ${text || "no body"}`);
  }
}
