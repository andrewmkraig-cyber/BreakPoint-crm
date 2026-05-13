import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getFreshAccessToken } from "@/lib/google-calendar";

// Pulls every readable Google Calendar the user has access to and mirrors
// a ±90-day event window into CalendarEvent. Designed to be called on
// demand from /api/calendar/sync; nothing here is incremental yet — every
// invocation re-scans the window and upserts. Skips free-busy-only
// calendars (no event read access) and skips events Google marked as
// cancelled.
//
// Token refresh delegates to src/lib/google-calendar.ts so the OAuth
// dance lives in one place. If the user has no Google Account row, we
// throw a distinct "No Google account linked." error the route layer
// surfaces verbatim.

const WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

type GoogleCalendarListItem = {
  id: string;
  summary?: string;
  backgroundColor?: string;
  accessRole?: string;
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListItem[];
};

type GoogleEventTime = {
  dateTime?: string;
  date?: string;
};

type GoogleEventAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  location?: string;
  attendees?: GoogleEventAttendee[];
  hangoutLink?: string;
  htmlLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

function pickMeetLink(ev: GoogleEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  const video = ev.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video" && typeof e.uri === "string",
  );
  return video?.uri ?? null;
}

type GoogleEventsResponse = {
  items?: GoogleEvent[];
};

export type SyncResult = {
  calendarsScanned: number;
  eventsSynced: number;
};

export async function syncGoogleCalendars(
  userId: string,
  organizationId: string,
): Promise<SyncResult> {
  // Step 1: verify the user has a linked Google account at all. The token
  // refresh helper conflates "no row" + "no refresh token" into a single
  // error message; we want the no-row case to surface its own message so
  // the UI can route users to the connectors page instead of telling them
  // to sign out.
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { id: true },
  });
  if (!account) {
    throw new Error("No Google account linked.");
  }

  // Step 2: token refresh + 60-second buffer is handled inside
  // getFreshAccessToken. It throws a message containing "sign out and
  // sign back in" when the refresh token is missing or revoked.
  const accessToken = await getFreshAccessToken(userId);

  // Step 3: pull every calendar visible to this user.
  const listRes = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    },
  );
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => "");
    throw new Error(`Calendar list failed (${listRes.status}): ${text || "no body"}`);
  }
  const listJson = (await listRes.json()) as GoogleCalendarListResponse;
  const calendars = listJson.items ?? [];

  const now = Date.now();
  const timeMin = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const timeMax = new Date(now + WINDOW_DAYS * DAY_MS).toISOString();

  let eventsSynced = 0;

  for (const cal of calendars) {
    // freeBusyReader gets you /freeBusy access only — calendarList shows
    // them, but /events on the same id returns 403. Skip outright.
    if (cal.accessRole === "freeBusyReader") continue;
    if (!cal.id) continue;

    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`,
    );
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", "500");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const eventsRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!eventsRes.ok) {
      // 404/410 on a calendar we just listed is benign (deleted between
      // calls); 403 means downgraded access. Skip and continue — one bad
      // calendar shouldn't take down the whole sync.
      continue;
    }
    const eventsJson = (await eventsRes.json()) as GoogleEventsResponse;
    const events = eventsJson.items ?? [];

    for (const ev of events) {
      if (!ev.id) continue;
      if (ev.status === "cancelled") continue;

      const startSource = ev.start?.dateTime ?? ev.start?.date;
      const endSource = ev.end?.dateTime ?? ev.end?.date;
      const startTime = startSource ? new Date(startSource) : new Date(now);
      const endTime = endSource ? new Date(endSource) : new Date(now);
      const allDay = !ev.start?.dateTime;
      const status: "CONFIRMED" | "TENTATIVE" =
        ev.status === "tentative" ? "TENTATIVE" : "CONFIRMED";

      const meetLink = pickMeetLink(ev);
      const htmlLink = ev.htmlLink ?? null;

      await prisma.calendarEvent.upsert({
        where: {
          organizationId_googleEventId_calendarId: {
            organizationId,
            googleEventId: ev.id,
            calendarId: cal.id,
          },
        },
        create: {
          organizationId,
          googleEventId: ev.id,
          calendarId: cal.id,
          calendarName: cal.summary ?? "primary",
          calendarColor: cal.backgroundColor ?? null,
          title: ev.summary ?? "(No title)",
          description: ev.description ?? null,
          startTime,
          endTime,
          allDay,
          location: ev.location ?? null,
          meetLink,
          htmlLink,
          attendees: ev.attendees
            ? (ev.attendees as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          status,
          syncedAt: new Date(),
        },
        update: {
          calendarName: cal.summary ?? "primary",
          calendarColor: cal.backgroundColor ?? null,
          title: ev.summary ?? "(No title)",
          description: ev.description ?? null,
          startTime,
          endTime,
          allDay,
          location: ev.location ?? null,
          meetLink,
          htmlLink,
          attendees: ev.attendees
            ? (ev.attendees as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          status,
          syncedAt: new Date(),
        },
      });
      eventsSynced += 1;
    }
  }

  return { calendarsScanned: calendars.length, eventsSynced };
}
