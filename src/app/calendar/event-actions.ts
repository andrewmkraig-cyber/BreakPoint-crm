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
  // ISO strings - the drawer builds these from <input type="date"> +
  // <input type="time"> in America/New_York. We trust the caller to
  // hand us valid ISO; bad input fails at new Date() validation
  // below.
  startISO?: string;
  endISO?: string;
  // YYYY-MM-DD from the drawer date field. Present in the current client
  // and optional so older cached clients still hit the server action safely.
  date?: string;
  // YYYY-MM-DD LAST covered day for a multi-day all-day block. Optional so
  // older cached clients (which only sent `date`) keep working as single-day.
  endDate?: string;
  allDay?: boolean;
  location: string | null;
  notes: string | null;
  // Guests added via the typeahead this session. We merge them onto
  // the existing attendees from Neon (the source of truth for
  // "current attendees on the Google event"); existing guests are
  // never removed from this path - explicit guest removal is its own
  // future affordance.
  newGuests: NewGuest[];
  // "all" = single patch with sendUpdates="all" - everyone gets an
  // email. "new" = two-pass: silent field patch, then a second
  // attendee-only patch with sendUpdates="all" so only freshly added
  // emails get an invite. "none" = single silent patch (sendUpdates
  // "none") with attendees merged in - useful for tweaking your own
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
  // IANA timezone the recruiter picked in the drawer. startISO/endISO
  // already carry the resolved absolute instant; this rides along so
  // Google displays the event in the chosen zone. Defaults to ET.
  timeZone?: string;
};

const REMINDER_LEAD_MS = 15 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/New_York";

// Google returns 403 when we try to PATCH/DELETE an event on a
// read-only calendar (e.g. the mirrored "Holidays in <country>"
// feed) or one we don't own. patchCalendarEventDetails /
// deleteCalendarEvent surface that as a thrown Error whose message
// carries the status code. Detect it so the actions can fail
// gracefully ("can't edit") or fall back to a local-only delete
// instead of letting the throw mask into a 500.
function isForbiddenGoogleError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /\(403\)/.test(msg) || /forbidden/i.test(msg);
}

function utcDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type UpdateCalendarEventResult =
  | { ok: true }
  | { ok: false; error: string };

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
): Promise<UpdateCalendarEventResult> {
  const { userId, row } = await loadSelfAndRow(input.id);

  const isAllDay = input.allDay ?? row.allDay;
  const allDayDate = isAllDay
    ? input.date ??
      (input.startISO ? utcDateOnly(new Date(input.startISO)) : undefined) ??
      utcDateOnly(row.startTime)
    : undefined;
  const range = isAllDay
    ? buildStartEndForDay(allDayDate!, input.endDate)
    : buildStartEndForTimedISO(input.startISO ?? "", input.endISO ?? "");
  const start = range.startDate;
  const end = range.endDate;
  const durationMin = range.durationMin;
  const tz = input.timeZone || DEFAULT_TIMEZONE;
  // Google's end.date is exclusive — range.endDate is already the day after
  // the last covered day (noon UTC), so utcDateOnly hands the API the right
  // boundary for both single- and multi-day all-day blocks.
  const allDayEndDate = isAllDay ? utcDateOnly(end) : undefined;

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

  // Outgoing payload - Google rejects unexpected fields, so strip to
  // the ones the API accepts on PATCH.
  const apiAttendees = mergedAttendees
    .filter((a): a is AttendeeJson & { email: string } => Boolean(a.email))
    .map((a) => ({ email: a.email, displayName: a.displayName }));

  // Push the edit to Google first. A 403 here means the event lives
  // on a read-only calendar (e.g. a mirrored holiday feed) or one we
  // don't own - Google won't let us patch it. Catch that instead of
  // rethrowing so the drawer shows a clean message rather than a
  // masked 500, and bail before mirroring a change that never landed.
  try {
    if (input.notifyMode === "all") {
      await patchCalendarEventDetails({
        userId,
        eventId: row.googleEventId,
        calendarId: row.calendarId,
        sendUpdates: "all",
        allDayDate,
        allDayEndDate,
        startISO: isAllDay ? undefined : input.startISO,
        durationMin: isAllDay ? undefined : durationMin,
        timeZone: isAllDay ? undefined : tz,
        summary: input.title,
        description: input.notes ?? "",
        location: input.location,
        attendees: apiAttendees,
      });
    } else if (input.notifyMode === "new") {
      // Pass 1: silent field patch - existing guests see the event
      // update but don't get an email.
      await patchCalendarEventDetails({
        userId,
        eventId: row.googleEventId,
        calendarId: row.calendarId,
        sendUpdates: "none",
        allDayDate,
        allDayEndDate,
        startISO: isAllDay ? undefined : input.startISO,
        durationMin: isAllDay ? undefined : durationMin,
        timeZone: isAllDay ? undefined : tz,
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
      // emails go out - Andrew can edit his own copy without spamming.
      await patchCalendarEventDetails({
        userId,
        eventId: row.googleEventId,
        calendarId: row.calendarId,
        sendUpdates: "none",
        allDayDate,
        allDayEndDate,
        startISO: isAllDay ? undefined : input.startISO,
        durationMin: isAllDay ? undefined : durationMin,
        timeZone: isAllDay ? undefined : tz,
        summary: input.title,
        description: input.notes ?? "",
        location: input.location,
        attendees: apiAttendees,
      });
    }
  } catch (e) {
    if (isForbiddenGoogleError(e)) {
      return {
        ok: false,
        error:
          "This event is from a read-only calendar and can't be edited in Ace.",
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to update event.",
    };
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
      allDay: isAllDay,
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

  // A scheduled interview owns its reminder keyed on interviewId (set by
  // upsertInterviewReminder at start - 60 min), NOT on calendarEventId. The
  // tracking calendar event the recruiter sees mirrors
  // Interview.googleEventIdMine, so find that interview and fold its reminder
  // into the dedup below. Without this, the now-default-ON interview reminder
  // toggle would stack a SECOND, duplicate reminder every time a recruiter
  // reopens an interview event and saves.
  const linkedInterview = row.googleEventId
    ? await prisma.interview.findFirst({
        where: {
          organizationId: row.organizationId,
          // An interview's calendar presence can be the organizer tracking
          // event OR the client / candidate invite events — match any so the
          // dedup holds whichever copy the recruiter reopened.
          OR: [
            { googleEventIdMine: row.googleEventId },
            { googleEventIdClient: row.googleEventId },
            { googleEventIdCandidate: row.googleEventId },
          ],
        },
        select: { id: true },
      })
    : null;
  const reminderMatch = [
    { calendarEventId: { in: mirrorIds } },
    ...(linkedInterview ? [{ interviewId: linkedInterview.id }] : []),
  ];

  if (input.reminderEnabled) {
    const reminderAt = new Date(start.getTime() - REMINDER_LEAD_MS);
    const existing = await prisma.aceReminder.findFirst({
      where: {
        organizationId: row.organizationId,
        dismissed: false,
        OR: reminderMatch,
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
          // reminderAt is already start - 15 min, so fire exactly at it.
          notifyLeadsMin: [0],
          notifiedLeadsMin: [],
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
          notifyLeadsMin: [0],
        },
      });
    }
  } else {
    await prisma.aceReminder.updateMany({
      where: {
        organizationId: row.organizationId,
        dismissed: false,
        OR: reminderMatch,
      },
      data: { dismissed: true },
    });
  }

  revalidatePath("/calendar");
  // Dashboard's "This Week" widget renders the same events and reads
  // reminder linkage server-side, so it needs invalidation too - otherwise
  // a save from the dashboard tile lands in Neon but the reopened drawer
  // keeps showing the pre-save type / reminder state.
  revalidatePath("/dashboard");

  return { ok: true };
}

export type CreateMeetingType =
  | "google_meet"
  | "teams"
  | "in_person"
  | "phone"
  | "none";

export type CreateCalendarEventInput = {
  title: string;
  // Required when allDay is true. YYYY-MM-DD - the server builds a
  // midnight-to-midnight ET range from it.
  date: string;
  // Optional LAST covered day (YYYY-MM-DD) for a multi-day all-day block.
  // Omit for a single-day all-day event.
  endDate?: string;
  // For timed events the client (browser, always in ET for our
  // recruiters) builds the wall-clock as a local Date and hands us
  // its toISOString(). Doing this on the client mirrors
  // updateCalendarEventAction's `startISO` / `endISO` contract; doing
  // it server-side would skew by the ET offset because Vercel's Node
  // runtime parses naive datetime strings as UTC.
  startISO?: string;
  endISO?: string;
  allDay: boolean;
  meetingType: CreateMeetingType;
  location: string | null;
  notes: string | null;
  candidateId: string | null;
  clientId: string | null;
  // Free-text email addresses entered as chips in the modal's TO /
  // CC / BCC fields. Google Calendar's attendees array does NOT
  // distinguish TO/CC/BCC - every entry is just an attendee - so
  // the three lists are flattened into one attendees payload here.
  // We preserve the TO/CC/BCC split in the activity log metadata for
  // audit, but the recipients see only "you're invited," not which
  // bucket they sat in. BCC is therefore visible to other attendees
  // in the Google UI; if true blind-cc is ever needed it would have
  // to be a separate per-recipient send-as-organizer flow.
  // When any recipient is present we flip sendUpdates so Google
  // actually mails the invite - otherwise the attendees row lands
  // silently and nobody sees it.
  to: string[];
  cc: string[];
  bcc: string[];
  // Optional recruiter-chosen event type from the unified create
  // drawer's pill picker. When supplied, overrides the candidate /
  // client linkage heuristic so a personal "reminder" doesn't get
  // mis-derived to "other" just because it has no candidate/client
  // attached.
  type?: CalendarEventType;
  // IANA timezone the recruiter picked. startISO/endISO already carry
  // the resolved instant; this rides along so Google displays the
  // event in the chosen zone. Defaults to ET.
  timeZone?: string;
};

export type CreateCalendarEventResult =
  | { ok: true; eventId: string; meetLink: string | null }
  | { ok: false; error: string };

// All-day events render in Google as a single date range with no
// timezone - start/end use the YYYY-MM-DD form. For Ace mirror rows
// we still store concrete Date objects (midnight to midnight ET) so
// the grid math reuses the same code path as timed events.

function parseDateOnly(date: string): [number, number, number] {
  const parts = date.split("-");
  if (parts.length !== 3) throw new Error("Invalid date");
  const [y, m, d] = parts.map((p) => Number.parseInt(p, 10));
  if (![y, m, d].every((n) => Number.isFinite(n))) {
    throw new Error("Invalid date");
  }
  return [y, m, d];
}

// Builds the stored Date range for an all-day block. `date` is the first
// covered day (YYYY-MM-DD); `endDateInclusive`, when supplied, is the LAST
// covered day (also YYYY-MM-DD) for a multi-day span. We store endDate as
// the EXCLUSIVE end (the day AFTER the last covered day) so it matches
// Google's end.date and the grid's endTime-minus-one-day math. A missing,
// invalid, or earlier-than-start end collapses to a single day.
function buildStartEndForDay(
  date: string,
  endDateInclusive?: string,
): { startISO: string; endISO: string; durationMin: number; startDate: Date; endDate: Date } {
  // YYYY-MM-DD → assume midnight ET → date-only block.
  const [y, m, d] = parseDateOnly(date);
  // 12:00 UTC keeps us inside the same calendar day for ET regardless
  // of DST - the grid only reads startTime.getDate() / .getMonth() /
  // .getFullYear() in local time, and ET is always UTC-4 or UTC-5.
  const startDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  let endDate = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  if (endDateInclusive) {
    const [ey, em, ed] = parseDateOnly(endDateInclusive);
    // +1 day → exclusive end.
    const candidate = new Date(Date.UTC(ey, em - 1, ed + 1, 12, 0, 0));
    if (candidate.getTime() > startDate.getTime()) {
      endDate = candidate;
    }
  }
  return {
    startISO: startDate.toISOString(),
    endISO: endDate.toISOString(),
    durationMin: Math.round((endDate.getTime() - startDate.getTime()) / 60_000),
    startDate,
    endDate,
  };
}

function buildStartEndForTimedISO(
  startISO: string,
  endISO: string,
): { startISO: string; endISO: string; durationMin: number; startDate: Date; endDate: Date } {
  const startDate = new Date(startISO);
  const endDate = new Date(endISO);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid start/end time");
  }
  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error("End must be after start");
  }
  const durationMin = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / 60_000),
  );
  return {
    startISO,
    endISO,
    durationMin,
    startDate,
    endDate,
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

    if (!input.allDay && (!input.startISO || !input.endISO)) {
      return { ok: false, error: "Missing start/end time." };
    }
    const range = input.allDay
      ? buildStartEndForDay(input.date, input.endDate)
      : buildStartEndForTimedISO(input.startISO!, input.endISO!);

    // Teams requires its own connected token at the org level - fail
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

    const cleanList = (list: string[] | undefined): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of list ?? []) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
      }
      return out;
    };
    const toList = cleanList(input.to);
    const ccList = cleanList(input.cc);
    const bccList = cleanList(input.bcc);
    // Flatten into one attendees payload. Google has no TO/CC/BCC
    // attendee distinction; the recruiter's grouping in the modal
    // is preserved in the activity log only. Cross-bucket dedup so
    // an address typed twice doesn't generate a duplicate invite.
    const allRecipients = cleanList([...toList, ...ccList, ...bccList]);
    const recipientAttendees = allRecipients.map((email) => ({
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
      allDayDate: input.allDay ? input.date : undefined,
      // Exclusive end for a multi-day all-day block (range.endDate is the
      // day after the last covered day, in noon-UTC form).
      allDayEndDate: input.allDay ? utcDateOnly(range.endDate) : undefined,
      createMeet: wantsMeet,
      location: mirroredLocation ?? undefined,
      // Notify recipients so the invite lands in their inbox.
      // Without this, Google saves the attendees row but suppresses
      // the email and the recruiter ends up texting them the link.
      sendUpdates: recipientAttendees.length > 0,
      attendees: recipientAttendees.length > 0 ? recipientAttendees : undefined,
      timeZone: input.timeZone || DEFAULT_TIMEZONE,
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
    const eventType = input.type ?? deriveEventType(input.candidateId, input.clientId);
    // Mirror attendees so the drawer renders the recipient list
    // immediately without waiting for the next full sync. Shape
    // matches what google-sync writes: { email, responseStatus }.
    const mirroredAttendees = recipientAttendees.length > 0
      ? recipientAttendees.map((a) => ({ email: a.email, responseStatus: a.responseStatus }))
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
        toCount: toList.length,
        ccCount: ccList.length,
        bccCount: bccList.length,
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

export type QuickContactSuggestion = {
  // Display label rendered in the dropdown row. "First Last (email)"
  // for candidate matches; "Client Company Name (contact email)" for
  // contacts attached to a client; falls back to the contact's own
  // name when no client is linked.
  label: string;
  // Plain email address committed into the chip when the recruiter
  // picks this row.
  email: string;
};

const QUICK_CONTACT_LIMIT = 8;

// Unified typeahead backing the CreateEventModal's TO / CC / BCC
// chip inputs. Searches Neon candidates and Neon contacts (which
// hang off Client) in one round trip, projects to a flat
// { label, email } shape, dedupes by email case-insensitively, and
// caps the combined list at 8 rows. Returns [] when the query is
// shorter than 2 characters so the modal doesn't render a dropdown
// for an empty / one-char input.
export async function quickSearchContacts(
  query: string,
): Promise<QuickContactSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const org = await getCurrentOrg();

  // Two parallel queries - small org-scoped result sets, no need for
  // a fancier ranking pipeline. We over-fetch each side (LIMIT 8) so
  // a candidate-heavy or contact-heavy match doesn't starve the
  // other category before dedup + final cap.
  const [candidates, contacts] = await Promise.all([
    prisma.candidate.findMany({
      where: {
        organizationId: org.id,
        email: { not: null },
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: QUICK_CONTACT_LIMIT,
      select: { firstName: true, lastName: true, email: true },
    }),
    prisma.contact.findMany({
      where: {
        organizationId: org.id,
        emails: { isEmpty: false },
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          // Postgres String[] `has` is exact-match only - fine for the
          // "user typed a full email" case; partial-email matches
          // surface via the related client name + contact name.
          { emails: { has: q } },
          { client: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: QUICK_CONTACT_LIMIT,
      select: {
        name: true,
        firstName: true,
        lastName: true,
        emails: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  const out: QuickContactSuggestion[] = [];

  for (const c of candidates) {
    if (!c.email) continue;
    const fullName = [c.firstName, c.lastName]
      .map((p) => p?.trim() ?? "")
      .filter((p) => p.length > 0)
      .join(" ")
      .trim();
    const label = fullName ? `${fullName} (${c.email})` : c.email;
    out.push({ label, email: c.email });
  }

  for (const c of contacts) {
    const contactName = (
      c.name ??
      [c.firstName, c.lastName]
        .map((p) => p?.trim() ?? "")
        .filter((p) => p.length > 0)
        .join(" ")
    )?.trim();
    // Prompt's mental model is "Company Name (email)" for clients.
    // Fall back to the contact's own name if the contact isn't linked
    // to a Client, so an unlinked contact still surfaces with a label
    // instead of just "Contact (email)".
    const display = c.client?.name?.trim() || contactName || "Contact";
    for (const email of c.emails) {
      const trimmedEmail = email?.trim();
      if (!trimmedEmail) continue;
      out.push({ label: `${display} (${trimmedEmail})`, email: trimmedEmail });
    }
  }

  // Dedupe by email (case-insensitive) and cap at the combined limit.
  // Candidates land first so a Candidate.email match wins over a
  // Contact row that happens to carry the same address.
  const seen = new Set<string>();
  const deduped: QuickContactSuggestion[] = [];
  for (const s of out) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
    if (deduped.length >= QUICK_CONTACT_LIMIT) break;
  }
  return deduped;
}

export type DeleteCalendarEventResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteCalendarEventAction(input: {
  id: string;
  notifyAll: boolean;
}): Promise<DeleteCalendarEventResult> {
  const { userId, row } = await loadSelfAndRow(input.id);
  // Try to delete on Google first. deleteCalendarEvent already treats
  // 404/410 (already gone) as success, so the only throw left is a
  // genuine failure. A 403 means a read-only / not-owned calendar
  // (e.g. a mirrored holiday feed): Google refuses, but we still want
  // to drop Ace's mirror so the event leaves the recruiter's view.
  // Any other error is unexpected (network, 500) - surface a clean
  // failure instead of silently dropping the local row.
  try {
    await deleteCalendarEvent({
      userId,
      eventId: row.googleEventId,
      calendarId: row.calendarId,
      sendUpdates: input.notifyAll,
    });
  } catch (e) {
    if (!isForbiddenGoogleError(e)) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Failed to delete event.",
      };
    }
    // Forbidden: fall through to the local-only delete below - this is
    // a "remove from view" that drops the mirror without touching
    // Google.
  }
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

  return { ok: true };
}
