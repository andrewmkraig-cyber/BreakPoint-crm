"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  deleteCalendarEvent,
  patchCalendarEventDetails,
} from "@/lib/google-calendar";
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
