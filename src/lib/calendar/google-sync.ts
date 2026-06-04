import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getFreshAccessToken } from "@/lib/google-calendar";
import { googleEventColor, GOOGLE_EVENT_COLORS } from "@/lib/calendar/google-colors";
import { isSuppressedGoogleMirror } from "@/lib/calendar/suppressed-google-mirrors";

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

const PAST_WINDOW_DAYS = 90;
const FUTURE_WINDOW_DAYS = 400;
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
  colorId?: string;
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

function dateOnlyToDisplayDate(date: string): Date {
  const [year, month, day] = date.split("-").map((n) => Number.parseInt(n, 10));
  if (![year, month, day].every((n) => Number.isFinite(n))) {
    return new Date(date);
  }
  // Keep date-only Google events inside the intended local calendar day.
  // `new Date("YYYY-MM-DD")` is midnight UTC, which renders as the prior
  // evening in Eastern time and makes all-day events look like timed ones.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

type GoogleEventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
};

type GoogleColorsResponse = {
  event?: Record<string, { background?: string }>;
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
  const windowStart = new Date(now - PAST_WINDOW_DAYS * DAY_MS);
  const windowEnd = new Date(now + FUTURE_WINDOW_DAYS * DAY_MS);
  const timeMin = windowStart.toISOString();
  const timeMax = windowEnd.toISOString();
  const colorRes = await fetch("https://www.googleapis.com/calendar/v3/colors", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const colorJson = colorRes.ok
    ? ((await colorRes.json()) as GoogleColorsResponse)
    : ({ event: undefined } satisfies GoogleColorsResponse);
  const eventColors = colorJson.event ?? Object.fromEntries(
    Object.entries(GOOGLE_EVENT_COLORS).map(([id, background]) => [id, { background }]),
  );

  let eventsSynced = 0;

  for (const cal of calendars) {
    // freeBusyReader gets you /freeBusy access only — calendarList shows
    // them, but /events on the same id returns 403. Skip outright.
    if (cal.accessRole === "freeBusyReader") continue;
    // reader-role calendars are read-only: holiday feeds, birthdays, and
    // subscribed shares the user can't edit. Mirroring them made events
    // like "Republic Day" look like the user's own (editing/deleting
    // 403s, and a local delete returned on the next sync). Only ingest
    // calendars we own or can write to. Writable shares (Austin's, team
    // calendars) carry "owner"/"writer" and are unaffected.
    if (cal.accessRole === "reader") continue;
    if (!cal.id) continue;

    const seenEventIds = new Set<string>();
    let pageToken: string | undefined;
    let calendarReadOk = true;

    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`,
      );
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("maxResults", "500");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const eventsRes = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!eventsRes.ok) {
        // 404/410 on a calendar we just listed is benign (deleted between
        // calls); 403 means downgraded access. Skip and continue — one bad
        // calendar shouldn't take down the whole sync.
        calendarReadOk = false;
        pageToken = undefined;
        break;
      }
      const eventsJson = (await eventsRes.json()) as GoogleEventsResponse;
      const events = eventsJson.items ?? [];
      pageToken = eventsJson.nextPageToken;

      for (const ev of events) {
      if (!ev.id) continue;
      // Google may still surface a cancelled event in a window-scoped
      // list (status === "cancelled"). Don't skip — that left stale
      // CONFIRMED mirror rows around for events we'd deleted via the
      // interview cancel flow, which is what put a "second" Jennifer
      // Cole interview on the Clubhouse / This Week widget. Flip any
      // matching local row to CANCELLED so it falls out of the widget
      // + /calendar queries (both filter status != CANCELLED).
      if (ev.status === "cancelled") {
        try {
          await prisma.calendarEvent.updateMany({
            where: {
              organizationId,
              googleEventId: ev.id,
              calendarId: cal.id,
            },
            data: { status: "CANCELLED", syncedAt: new Date() },
          });
        } catch {
          // best-effort
        }
        continue;
      }

      const allDay = !ev.start?.dateTime;
      const startTime = ev.start?.dateTime
        ? new Date(ev.start.dateTime)
        : ev.start?.date
          ? dateOnlyToDisplayDate(ev.start.date)
          : new Date(now);
      const endTime = ev.end?.dateTime
        ? new Date(ev.end.dateTime)
        : ev.end?.date
          ? dateOnlyToDisplayDate(ev.end.date)
          : new Date(now);
      if (isSuppressedGoogleMirror(ev.summary, startTime)) {
        continue;
      }

      seenEventIds.add(ev.id);

      const status: "CONFIRMED" | "TENTATIVE" =
        ev.status === "tentative" ? "TENTATIVE" : "CONFIRMED";

      const meetLink = pickMeetLink(ev);
      const htmlLink = ev.htmlLink ?? null;
      const eventColor = googleEventColor(ev.colorId, eventColors);

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
          calendarColor: eventColor,
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
          calendarColor: eventColor,
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
    } while (pageToken);

    if (calendarReadOk) {
      await prisma.calendarEvent.updateMany({
        where: {
          organizationId,
          calendarId: cal.id,
          status: { not: "CANCELLED" },
          startTime: { gte: windowStart, lt: windowEnd },
          ...(seenEventIds.size > 0
            ? { googleEventId: { notIn: Array.from(seenEventIds) } }
            : {}),
        },
        data: { status: "CANCELLED", syncedAt: new Date() },
      });
    }
  }

  return { calendarsScanned: calendars.length, eventsSynced };
}
