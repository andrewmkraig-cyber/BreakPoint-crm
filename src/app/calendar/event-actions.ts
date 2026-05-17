"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { logActivity } from "@/lib/activity";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  patchCalendarEventDetails,
} from "@/lib/google-calendar";
import { createTeamsMeeting } from "@/lib/microsoft-graph";
import { prisma } from "@/lib/prisma";
import type { CalendarEventType } from "@/lib/calendar/types";

// Server actions backing the calendar event drawer's Save / Delete.
// All actions push to Google first, then mirror the change into Neon
// so the next render is consistent even if the Sync button hasn't
// been clicked. revalidatePath("/calendar") makes the page re-fetch
// from Neon so the drawer caller's `router.refresh()` sees the
// updated row immediately.

type AttendeeJson = {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  responseStatus?: string;
  optional?: boolean;
};

type NewGuest = { email: string; name?: string };

export type UpdateCalendarEventInput = {
  id: string;
  title: string;
  // ISO strings — the drawer builds these from <input type="date"> +
  // <input type="time"> in America/New_York. We trust the caller to
  // hand us valid ISO; bad input fails at new Date() validation
  // below.
  startISO: string;
  endISO: string;
  location: string | null;
  notes: string | null;
  // Guests added via the typeahead this session. We merge them onto
  // the existing attendees from Neon (the source of truth for
  // "current attendees on the Google event"); existing guests are
  // never removed from this path — explicit guest removal is its own
  // future affordance.
  newGuests: NewGuest[];
  // "all" = single patch with sendUpdates="all" — everyone gets an
  // email. "new" = two-pass: silent field patch, then a second
  // attendee-only patch with sendUpdates="all" so only freshly added
  // emails get an invite. "none" = single silent patch (sendUpdates
  // "none") with attendees merged in — useful for tweaking your own
  // event without spamming anyone.
  notifyMode: "all" | "new" | "none";
  // Ace-native reminder toggle from the drawer. When true, we upsert
  // an AceReminder at startTime - 15 min linked to this CalendarEvent
  // so the global toast provider fires when it slips past now. When
  // false, we dismiss any matching reminders so the toggle going off
  // takes effect immediately.
  reminderEnabled: boolean;
  // Recruiter-chosen event type from the drawer pill picker. Persisted
  // verbatim to CalendarEvent.typeOverride; readers prefer this over
  // the title-based deriveType heuristic when set.
  type: CalendarEventType;
};

const REMINDER_LEAD_MS = 15 * 60 * 1000;

async function loadSelfAndRow(eventId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Unauthorized");
  const org = await getCurrentOrg();
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) throw new Error("Session user missing from Neon");
  const row = await prisma.calendarEvent.findFirst({
    where: { id: eventId, organizationId: org.id },
  });
  if (!row) throw new Error("Event not found");
  return { userId: user.id, row };
}

export async function updateCalendarEventAction(
  input: UpdateCalendarEventInput,
): Promise<void> {
  const { userId, row } = await loadSelfAndRow(input.id);

  const start = new Date(input.startISO);
  const end = new Date(input.endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid start/end time");
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error("End must be after start");
  }
  const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));

  const existingAttendees: AttendeeJson[] =
    (row.attendees as AttendeeJson[] | null) ?? [];
  const existingEmails = new Set(
    existingAttendees
      .map((a) => (a.email ?? "").toLowerCase())
      .filter((s) => s.length > 0),
  );
  const dedupedNew = input.newGuests.filter(
    (g) => g.email && !existingEmails.has(g.email.toLowerCase()),
  );
  const mergedAttendees: AttendeeJson[] = [
    ...existingAttendees,
    ...dedupedNew.map((g) => ({ email: g.email, displayName: g.name })),
  ];

  // Outgoing payload — Google rejects unexpected fields, so strip to
  // the ones the API accepts on PATCH.
  const apiAttendees = mergedAttendees
    .filter((a): a is AttendeeJson & { email: string } => Boolean(a.email))
    .map((a) => ({ email: a.email, displayName: a.displayName }));

  if (input.notifyMode === "all") {
    await patchCalendarEventDetails({
      userId,
      eventId: row.googleEventId,
      calendarId: row.calendarId,
      sendUpdates: "all",
      startISO: input.startISO,
      durationMin,
      summary: input.title,
      description: input.notes ?? "",
      location: input.location,
      attendees: apiAttendees,
    });
  } else if (input.notifyMode === "new") {
    // Pass 1: silent field patch — existing guests see the event
    // update but don't get an email.
    await patchCalendarEventDetails({
      userId,
      eventId: row.googleEventId,
      calendarId: row.calendarId,
      sendUpdates: "none",
      startISO: input.startISO,
      durationMin,
      summary: input.title,
      description: input.notes ?? "",
      location: input.location,
    });
    // Pass 2: only patch attendees if any are new. sendUpdates="all"
    // + a list that diffs to the new emails means Google emails only
    // those.
    if (dedupedNew.length > 0) {
      await patchCalendarEventDetails({
        userId,
        eventId: row.googleEventId,
        calendarId: row.calendarId,
        sendUpdates: "all",
        attendees: apiAttendees,
      });
    }
  } else {
    // "none": one silent patch with everything (fields + merged
    // attendees). New guests get added to the Google event but no
    // emails go out — Andrew can edit his own copy without spamming.
    await patchCalendarEventDetails({
      userId,
      eventId: row.googleEventId,
      calendarId: row.calendarId,
      sendUpdates: "none",
      startISO: input.startISO,
      durationMin,
      summary: input.title,
      description: input.notes ?? "",
      location: input.location,
      attendees: apiAttendees,
    });
  }

  // Mirror to Neon. Every CalendarEvent row that shares this
  // googleEventId (the dedup case: Andrew's copy + Austin's copy)
  // gets the same updates so the page re-render sees consistent data
  // until the next full sync.
  await prisma.calendarEvent.updateMany({
    where: {
      organizationId: row.organizationId,
      googleEventId: row.googleEventId,
    },
    data: {
      title: input.title,
      description: input.notes,
      location: input.location,
      startTime: start,
      endTime: end,
      attendees: mergedAttendees as unknown as object,
      typeOverride: input.type,
      syncedAt: new Date(),
    },
  });

  // Reminder side-effect. Linked to every dedup mirror row so the
  // toggle reads correctly whichever copy the recruiter opens. We
  // dismiss instead of deleting so the toast provider can't re-fire
  // a stale reminder; a fresh create is a new row.
  const mirrorIds = (
    await prisma.calendarEvent.findMany({
      where: {
        organizationId: row.organizationId,
        googleEventId: row.googleEventId,
      },
      select: { id: true },
    })
  ).map((r) => r.id);

  if (input.reminderEnabled) {
    const reminderAt = new Date(start.getTime() - REMINDER_LEAD_MS);
    const existing = await prisma.aceReminder.findFirst({
      where: {
        organizationId: row.organizationId,
        calendarEventId: { in: mirrorIds },
        dismissed: false,
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.aceReminder.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          reminderAt,
          calendarEventId: row.id,
        },
      });
    } else {
      await prisma.aceReminder.create({
        data: {
          organizationId: row.organizationId,
          userId,
          title: input.title,
          reminderAt,
          calendarEventId: row.id,
        },
      });
    }
  } else {
    await prisma.aceReminder.updateMany({
      where: {
        organizationId: row.organizationId,
        calendarEventId: { in: mirrorIds },
        dismissed: false,
      },
      data: { dismissed: true },
    });
  }

  revalidatePath("/calendar");
  // Dashboard's "This Week" widget renders the same events and reads
  // reminder linkage server-side, so it needs invalidation too — otherwise
  // a save from the dashboard tile lands in Neon but the reopened drawer
  // keeps showing the pre-save type / reminder state.
  revalidatePath("/dashboard");
}

export type CreateMeetingType =
  | "google_meet"
  | "teams"
  | "in_person"
  | "phone"
  | "none";

export type CreateCalendarEventInput = {
  title: string;
  // Local-date string in YYYY-MM-DD; the action assembles the
  // start/end ISO strings against America/New_York rather than
  // forcing the client to do timezone math.
  date: string;
  // HH:MM 24h. Ignored when allDay is true.
  startTime: string;
  endTime: string;
  allDay: boolean;
  meetingType: CreateMeetingType;
  location: string | null;
  notes: string | null;
  candidateId: string | null;
  clientId: string | null;
  // Free-text email addresses entered as chips in the CC field.
  // Each address becomes a Google attendee with responseStatus
  // "needsAction". When at least one CC is present we flip
  // sendUpdates so Google actually mails the invite — otherwise the
  // attendees row lands silently and the recipients never see it.
  cc: string[];
};

export type CreateCalendarEventResult =
  | { ok: true; eventId: string; meetLink: string | null }
  | { ok: false; error: string };

// All-day events render in Google as a single date range with no
// timezone — start/end use the YYYY-MM-DD form. For Ace mirror rows
// we still store concrete Date objects (midnight to midnight ET) so
// the grid math reuses the same code path as timed events.
const ET_TIMEZONE = "America/New_York";

function buildStartEndForDay(date: string): { startISO: string; endISO: string; durationMin: number; startDate: Date; endDate: Date } {
  // YYYY-MM-DD → assume midnight ET → 24h block
  const parts = date.split("-");
  if (parts.length !== 3) throw new Error("Invalid date");
  const [y, m, d] = parts.map((p) => Number.parseInt(p, 10));
  if (![y, m, d].every((n) => Number.isFinite(n))) {
    throw new Error("Invalid date");
  }
  // 12:00 UTC keeps us inside the same calendar day for ET regardless
  // of DST — the grid only reads startTime.getDate() / .getMonth() /
  // .getFullYear() in local time, and ET is always UTC-4 or UTC-5.
  const startDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const endDate = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return {
    startISO: startDate.toISOString(),
    endISO: endDate.toISOString(),
    durationMin: 24 * 60,
    startDate,
    endDate,
  };
}

function buildStartEndForTimed(
  date: string,
  startTime: string,
  endTime: string,
): { startISO: string; endISO: string; durationMin: number; startDate: Date; endDate: Date } {
  const startLocal = new Date(`${date}T${startTime}:00`);
  const endLocal = new Date(`${date}T${endTime}:00`);
  if (Number.isNaN(startLocal.getTime()) || Number.isNaN(endLocal.getTime())) {
    throw new Error("Invalid start/end time");
  }
  if (endLocal.getTime() <= startLocal.getTime()) {
    throw new Error("End must be after start");
  }
  const durationMin = Math.max(
    1,
    Math.round((endLocal.getTime() - startLocal.getTime()) / 60_000),
  );
  return {
    startISO: startLocal.toISOString(),
    endISO: endLocal.toISOString(),
    durationMin,
    startDate: startLocal,
    endDate: endLocal,
  };
}

function deriveEventType(
  candidateId: string | null,
  clientId: string | null,
): CalendarEventType {
  if (candidateId && clientId) return "interview";
  if (candidateId) return "candidate";
  if (clientId) return "client";
  return "other";
}

export async function createCalendarEventAction(
  input: CreateCalendarEventInput,
): Promise<CreateCalendarEventResult> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { ok: false, error: "Unauthorized" };
    }
    const org = await getCurrentOrg();
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, email: true },
    });
    if (!user) {
      return { ok: false, error: "Session user missing from Neon" };
    }

    const title = input.title.trim();
    if (!title) return { ok: false, error: "Title is required" };

    const range = input.allDay
      ? buildStartEndForDay(input.date)
      : buildStartEndForTimed(input.date, input.startTime, input.endTime);

    // Teams requires its own connected token at the org level — fail
    // early so the recruiter doesn't see a half-created Google event.
    if (input.meetingType === "teams") {
      const token = await prisma.microsoftToken.findUnique({
        where: { organizationId: org.id },
        select: { id: true },
      });
      if (!token) {
        return {
          ok: false,
          error: "Microsoft Teams isn't connected for this org. Connect it in Settings → Connectors first.",
        };
      }
    }

    // Build the description: optional notes first, then a Teams join
    // line appended below so the link survives Google's rendering even
    // when the location field is reserved for an in-person address.
    let description = input.notes?.trim() ?? "";
    let mirroredLocation: string | null = null;
    if (input.meetingType === "in_person" && input.location?.trim()) {
      mirroredLocation = input.location.trim();
    }

    const ccAttendees = (input.cc ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((email) => ({
        email,
        responseStatus: "needsAction" as const,
      }));

    const wantsMeet = input.meetingType === "google_meet";
    const created = await createCalendarEvent({
      userId: user.id,
      summary: title,
      description,
      startISO: range.startISO,
      durationMin: range.durationMin,
      createMeet: wantsMeet,
      location: mirroredLocation ?? undefined,
      // Notify CC'd attendees so the invite lands in their inbox.
      // Without this, Google saves the attendees row but suppresses
      // the email and the recruiter ends up texting them the link.
      sendUpdates: ccAttendees.length > 0,
      attendees: ccAttendees.length > 0 ? ccAttendees : undefined,
      timeZone: ET_TIMEZONE,
    });

    let meetLink: string | null = created.meetLink ?? null;

    if (input.meetingType === "teams") {
      try {
        const meeting = await createTeamsMeeting({
          organizationId: org.id,
          startISO: range.startISO,
          endISO: range.endISO,
          subject: title,
        });
        meetLink = meeting.joinWebUrl;
        // Patch the Google event description so the join URL renders
        // in the calendar invite + grid drawer alongside any notes.
        const teamsLine = `Microsoft Teams: ${meeting.joinWebUrl}`;
        description = description ? `${description}\n\n${teamsLine}` : teamsLine;
        await patchCalendarEventDetails({
          userId: user.id,
          eventId: created.eventId,
          calendarId: "primary",
          sendUpdates: "none",
          description,
        });
      } catch (e) {
        // Roll back the Google event so we never leave an orphan with
        // no working join link.
        try {
          await deleteCalendarEvent({
            userId: user.id,
            eventId: created.eventId,
            sendUpdates: false,
          });
        } catch {
          // best-effort
        }
        return {
          ok: false,
          error: e instanceof Error
            ? `Teams meeting create failed: ${e.message}`
            : "Teams meeting create failed.",
        };
      }
    }

    // Mirror to Neon so the new event renders immediately without
    // waiting for the next /api/calendar/sync. Primary calendar id on
    // Google Workspace == the user's email; on the next full sync the
    // upsert key (organizationId + googleEventId + calendarId) lines
    // up and the row updates in place instead of duplicating.
    const calendarId = user.email ?? "primary";
    const eventType = deriveEventType(input.candidateId, input.clientId);
    // Mirror attendees so the drawer renders the CC list immediately
    // without waiting for the next full sync. Shape matches what
    // google-sync writes: { email, responseStatus, ... }.
    const mirroredAttendees = ccAttendees.length > 0
      ? ccAttendees.map((a) => ({ email: a.email, responseStatus: a.responseStatus }))
      : null;

    const mirror = await prisma.calendarEvent.create({
      data: {
        organizationId: org.id,
        googleEventId: created.eventId,
        calendarId,
        calendarName: "primary",
        calendarColor: null,
        title,
        description: description || null,
        startTime: range.startDate,
        endTime: range.endDate,
        allDay: input.allDay,
        location: mirroredLocation,
        meetLink,
        htmlLink: created.htmlLink,
        attendees: mirroredAttendees ?? undefined,
        candidateId: input.candidateId,
        clientId: input.clientId,
        typeOverride: eventType,
        syncedAt: new Date(),
      },
      select: { id: true },
    });

    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "calendar_event_created",
      targetType: "calendar_event",
      targetId: mirror.id,
      metadata: {
        title,
        meetingType: input.meetingType,
        candidateId: input.candidateId,
        clientId: input.clientId,
        ccCount: ccAttendees.length,
        allDay: input.allDay,
        startISO: range.startISO,
      },
    });

    revalidatePath("/calendar");
    revalidatePath("/dashboard");

    return { ok: true, eventId: mirror.id, meetLink };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create event.",
    };
  }
}

export async function deleteCalendarEventAction(input: {
  id: string;
  notifyAll: boolean;
}): Promise<void> {
  const { userId, row } = await loadSelfAndRow(input.id);
  await deleteCalendarEvent({
    userId,
    eventId: row.googleEventId,
    calendarId: row.calendarId,
    sendUpdates: input.notifyAll,
  });
  // Dismiss any AceReminder rows tied to this event so a deleted
  // meeting can't still pop a toast 15 min before its old start.
  const mirrorIds = (
    await prisma.calendarEvent.findMany({
      where: {
        organizationId: row.organizationId,
        googleEventId: row.googleEventId,
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  await prisma.aceReminder.updateMany({
    where: {
      organizationId: row.organizationId,
      calendarEventId: { in: mirrorIds },
    },
    data: { dismissed: true },
  });
  // Drop every mirror of this event across calendars.
  await prisma.calendarEvent.deleteMany({
    where: {
      organizationId: row.organizationId,
      googleEventId: row.googleEventId,
    },
  });
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}
