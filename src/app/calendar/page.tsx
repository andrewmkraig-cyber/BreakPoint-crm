import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  ownerKeyForCalendar,
  ownerKeyForPerson,
} from "@/lib/calendar/owner-key";
import type {
  CalendarEvent,
  CalendarEventType,
  CalendarReminder,
  CalendarTeamMember,
} from "@/lib/calendar/types";
import { htmlToReadableText } from "@/lib/merge-fields";
import { prisma } from "@/lib/prisma";

import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Calendar · Ace",
};

type AttendeeJson = { displayName?: string; email?: string };

// Court-mode safe palette for team member dots/avatars. Picked by a
// stable hash of the user id so a given user keeps the same color
// across refreshes without us storing the choice on User.
const TEAM_COLORS = [
  "#5A9642", // brand green
  "#1E40AF", // blue
  "#92400E", // amber
  "#7C3AED", // violet
  "#DB2777", // pink
  "#0F766E", // teal
];

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

function initialsFor(name: string | null, email: string | null): string {
  const source = (name && name.trim()) || (email && email.split("@")[0]) || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function deriveType(title: string, calendarName: string): CalendarEventType {
  const lcTitle = title.toLowerCase();
  const lcCal = calendarName.toLowerCase();
  if (lcTitle.includes("interview")) return "interview";
  if (
    lcTitle.includes("call") ||
    lcTitle.includes("meeting") ||
    lcTitle.includes("sync") ||
    lcTitle.includes("connect") ||
    lcTitle.includes("chat")
  ) {
    return "client";
  }
  if (lcCal.includes("reminder") || lcTitle.includes("reminder")) {
    return "reminder";
  }
  return "other";
}

function formatRelative(target: Date, base: Date): string {
  const diffMs = target.getTime() - base.getTime();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  if (absMin < 1) return diffMs >= 0 ? "now" : "just now";
  if (absMin < 60) return diffMs >= 0 ? `in ${absMin}m` : `${absMin}m ago`;
  const hours = Math.round(absMin / 60);
  if (hours < 24) return diffMs >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diffMs >= 0 ? `in ${days}d` : `${days}d ago`;
}

// Reminders are Ace-native and always read in Eastern. This formatter
// runs server-side (Vercel is UTC), so it MUST pin timeZone to ET -
// otherwise a 12:00 PM ET reminder (stored 16:00Z) renders as 4:00 PM.
// Mirrors the ET assumption baked into CalendarEventDrawer's zonedToInstant.
function formatAbsolute(target: Date): string {
  return target.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function CalendarPage() {
  const org = await getCurrentOrg();
  const session = await getServerSession(authOptions);
  const selfEmail = session?.user?.email?.toLowerCase() ?? null;

  const now = new Date();
  const windowMs = 90 * 24 * 60 * 60 * 1000;

  const [
    rowsRaw,
    memberships,
    reminderRows,
    eventLinkedReminders,
    cancelledInterviews,
    activeInterviews,
  ] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: {
        organizationId: org.id,
        status: { not: "CANCELLED" },
        startTime: {
          gte: new Date(now.getTime() - windowMs),
          lte: new Date(now.getTime() + windowMs),
        },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.organizationMembership.findMany({
      where: { organizationId: org.id },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { joinedAt: "asc" },
    }),
    // Standalone panel reminders only (event/interview-linked rows
    // already render as their own events). Pulled across the same
    // window as events so they can render on the grid; the panel slices
    // out the upcoming ones below.
    prisma.aceReminder.findMany({
      where: {
        organizationId: org.id,
        dismissed: false,
        calendarEventId: null,
        interviewId: null,
        reminderAt: {
          gte: new Date(now.getTime() - windowMs),
          lte: new Date(now.getTime() + windowMs),
        },
      },
      orderBy: { reminderAt: "asc" },
      select: { id: true, title: true, reminderAt: true, notifyLeadsMin: true },
    }),
    // Event-linked reminders - used to set the drawer's "Ace
    // reminder" toggle to its current state when the user reopens
    // the event. Only undismissed rows count (a dismissed reminder
    // means the toggle is effectively off again).
    prisma.aceReminder.findMany({
      where: {
        organizationId: org.id,
        dismissed: false,
        calendarEventId: { not: null },
      },
      select: { calendarEventId: true },
    }),
    prisma.interview.findMany({
      where: {
        organizationId: org.id,
        status: "cancelled",
        scheduledAt: {
          gte: new Date(now.getTime() - windowMs),
          lte: new Date(now.getTime() + windowMs),
        },
        OR: [
          { googleEventIdMine: { not: null } },
          { googleEventIdClient: { not: null } },
          { googleEventIdCandidate: { not: null } },
        ],
      },
      select: {
        googleEventIdMine: true,
        googleEventIdClient: true,
        googleEventIdCandidate: true,
      },
    }),
    prisma.interview.findMany({
      where: {
        organizationId: org.id,
        status: { not: "cancelled" },
        scheduledAt: {
          gte: new Date(now.getTime() - windowMs),
          lte: new Date(now.getTime() + windowMs),
        },
        OR: [
          { googleEventIdMine: { not: null } },
          { googleEventIdClient: { not: null } },
          { googleEventIdCandidate: { not: null } },
        ],
      },
      select: {
        id: true,
        candidateId: true,
        googleEventIdMine: true,
        googleEventIdClient: true,
        googleEventIdCandidate: true,
        sentCandidateSubject: true,
        sentCandidateBody: true,
        sentCandidateAt: true,
        sentClientSubject: true,
        sentClientBody: true,
        sentClientAt: true,
      },
    }),
  ]);
  const cancelledGoogleEventIds = new Set(
    cancelledInterviews
      .flatMap((iv) => [iv.googleEventIdMine, iv.googleEventIdClient, iv.googleEventIdCandidate])
      .filter((id): id is string => Boolean(id)),
  );
  const rows = rowsRaw.filter((row) => !cancelledGoogleEventIds.has(row.googleEventId));
  // Map each interview-owned googleEventId → its Interview.id + which party
  // the event represents + the verbatim subject/body that party was emailed.
  // This is the existing googleEventId → Interview.id pattern, enriched so
  // each rendered calendar block can show "what the recipient saw" and wire
  // interview-aware Edit / Cancel. The per-party events (candidate/client)
  // carry the stored sent copy; the organizer-only tracking event (mine,
  // when neither side was emailed — "client will send invites") maps as
  // party "none" with no stored copy. The natural count falls out of this:
  // two party events when both invites went out, one when a single side did,
  // one tracking event when none did.
  type InterviewEventMeta = {
    interviewId: string;
    candidateId: string | null;
    party: "candidate" | "client" | "none";
    sentSubject?: string;
    sentBody?: string;
  };
  const interviewMetaByGoogleEventId = new Map<string, InterviewEventMeta>();
  for (const iv of activeInterviews) {
    if (iv.googleEventIdCandidate) {
      interviewMetaByGoogleEventId.set(iv.googleEventIdCandidate, {
        interviewId: iv.id,
        candidateId: iv.candidateId,
        party: "candidate",
        sentSubject: iv.sentCandidateSubject ?? undefined,
        sentBody: iv.sentCandidateBody ?? undefined,
      });
    }
    if (iv.googleEventIdClient) {
      interviewMetaByGoogleEventId.set(iv.googleEventIdClient, {
        interviewId: iv.id,
        candidateId: iv.candidateId,
        party: "client",
        sentSubject: iv.sentClientSubject ?? undefined,
        sentBody: iv.sentClientBody ?? undefined,
      });
    }
    // The organizer tracking event only earns its own block when it wasn't
    // reused as a party event (i.e. nothing was emailed). If it already maps
    // to a party above, leave that richer mapping in place.
    if (iv.googleEventIdMine && !interviewMetaByGoogleEventId.has(iv.googleEventIdMine)) {
      interviewMetaByGoogleEventId.set(iv.googleEventIdMine, {
        interviewId: iv.id,
        candidateId: iv.candidateId,
        party: "none",
      });
    }
  }

  const eventsWithReminders = new Set(
    eventLinkedReminders
      .map((r) => r.calendarEventId)
      .filter((id): id is string => id != null),
  );

  // Team-member id is the normalized owner key ("ak", "austin",
  // …) - NOT the user.id cuid. Both this list and event.ownerId run
  // through the same helper so the left-rail toggle and the event
  // filter agree on what "Austin" means.
  const teamMembers: CalendarTeamMember[] = memberships.map((m) => ({
    id: ownerKeyForPerson({ name: m.user.name, email: m.user.email }),
    name: m.user.name ?? m.user.email ?? "Member",
    initials: initialsFor(m.user.name, m.user.email),
    color: colorFor(m.user.id),
    self: selfEmail !== null && m.user.email?.toLowerCase() === selfEmail,
    // Carries User.image through to the calendar grid avatars. May be
    // a /api/avatar/<userId> URL (the user uploaded one) or a Google
    // googleusercontent URL (still on the Google OAuth picture).
    image: m.user.image ?? null,
  }));

  // Self person hint for events whose calendar source carries no
  // identifying tokens (the signed-in user's primary calendar shows up
  // as `cal.id = "primary"` with their email-ish summary).
  const selfPerson =
    memberships.find(
      (m) => selfEmail !== null && m.user.email?.toLowerCase() === selfEmail,
    )?.user ?? null;

  // Merge rows that share googleEventId across calendars (e.g. a
  // meeting that lives on both Andrew's and Austin's calendars).
  // Keep the row whose ownerKey is self if present - that's the copy
  // Andrew can actually patch in Google. Other rows in the group
  // just contribute their ownerKey so the avatar stack + both
  // team-toggles know to claim the merged event.
  type Group = { rows: typeof rows; keys: Set<string> };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = row.googleEventId;
    const ownerKey = ownerKeyForCalendar(
      { calendarId: row.calendarId, calendarName: row.calendarName },
      selfPerson,
    );
    let g = groups.get(key);
    if (!g) {
      g = { rows: [], keys: new Set() };
      groups.set(key, g);
    }
    g.rows.push(row);
    g.keys.add(ownerKey);
  }

  const selfKey =
    selfPerson != null ? ownerKeyForPerson(selfPerson) : null;

  const events: CalendarEvent[] = Array.from(groups.values()).map(({ rows: groupRows, keys }) => {
    // Canonical row = the one Andrew can actually edit (his own
    // calendar). Falls back to the first row when self has no copy.
    const ownRow =
      selfPerson?.email != null
        ? groupRows.find(
            (r) => r.calendarId.toLowerCase() === selfPerson.email!.toLowerCase(),
          )
        : null;
    const row = ownRow ?? groupRows[0];
    const attendees = (row.attendees as AttendeeJson[] | null) ?? null;
    const guests = attendees
      ? attendees
          .map((a) => (a.displayName ?? a.email ?? "").trim())
          .filter((s) => s.length > 0)
      : undefined;
    // Sort keys deterministically so the avatar stack is stable
    // across renders. Self first, then alpha - matches how the rail
    // lists members.
    const ownerKeys = Array.from(keys).sort((a, b) => {
      if (selfKey) {
        if (a === selfKey) return -1;
        if (b === selfKey) return 1;
      }
      return a.localeCompare(b);
    });
    // Check every row in the dedup group - a reminder might be linked
    // to either Andrew's copy or Austin's copy of the same event.
    const reminderEnabled = groupRows.some((r) => eventsWithReminders.has(r.id));
    // Recruiter-chosen type wins over the title-based heuristic. The
    // override is mirrored to every row in the group on save, so any
    // dedup copy is a valid source.
    const overrideType = groupRows
      .map((r) => r.typeOverride as CalendarEventType | null)
      .find((t): t is CalendarEventType => t != null);
    // Find the interview meta for any googleEventId in this dedup group.
    const interviewMeta = groupRows
      .map((r) => interviewMetaByGoogleEventId.get(r.googleEventId))
      .find((m): m is InterviewEventMeta => m != null);
    const linkedInterview = interviewMeta != null;
    // Title + Notes render off the stored "what the recipient saw" copy when
    // a party invite went out (authoritative even if the Google event later
    // drifts); the organizer tracking-event ("none") and any not-yet-stored
    // case fall back to the synced Google summary/description.
    const displayTitle = interviewMeta?.sentSubject ?? row.title;
    // Stored sent-copy bodies can be HTML (older client-confirmation sends);
    // render them clean so the tile detail matches the real Google invite
    // instead of showing literal <p>/<br>. No-ops on plain text.
    const displayMeta = interviewMeta?.sentBody
      ? htmlToReadableText(interviewMeta.sentBody)
      : row.description ?? undefined;
    return {
      id: row.id,
      title: displayTitle,
      startTime: row.startTime,
      endTime: row.endTime,
      allDay: row.allDay,
      type: linkedInterview ? "interview" : overrideType ?? deriveType(row.title, row.calendarName),
      meta: displayMeta,
      guests,
      location: row.location ?? undefined,
      ownerKeys,
      jobId: row.jobId ?? undefined,
      // Prefer the interview's own candidateId (authoritative) so the
      // drawer's interview Edit can deep-link to the candidate profile.
      candidateId: interviewMeta?.candidateId ?? row.candidateId ?? undefined,
      clientId: row.clientId ?? undefined,
      calendarName: row.calendarName,
      calendarColor: row.calendarColor ?? undefined,
      meetLink: row.meetLink ?? undefined,
      htmlLink: row.htmlLink ?? undefined,
      reminderEnabled,
      interviewId: interviewMeta?.interviewId,
      interviewParty: interviewMeta?.party,
      sentSubject: interviewMeta?.sentSubject,
      sentBody: interviewMeta?.sentBody ? htmlToReadableText(interviewMeta.sentBody) : interviewMeta?.sentBody,
    };
  });

  // Standalone reminders rendered on the grid as reminder-type pseudo-
  // events. A 30-min visual block keeps the title readable instead of a
  // hairline sliver. aceReminderId marks them so a click opens the
  // reminders panel editor rather than the Google event drawer.
  const reminderEvents: CalendarEvent[] = reminderRows.map((r) => ({
    id: `reminder-${r.id}`,
    title: r.title,
    startTime: r.reminderAt,
    endTime: new Date(r.reminderAt.getTime() + 30 * 60 * 1000),
    allDay: false,
    type: "reminder",
    ownerKeys: [],
    aceReminderId: r.id,
    reminderLeadsMin: r.notifyLeadsMin,
  }));
  const allEvents = [...events, ...reminderEvents];

  const latestSyncedAt = rows.reduce<Date | null>((acc, row) => {
    if (!acc || row.syncedAt > acc) return row.syncedAt;
    return acc;
  }, null);

  // Reminders are Ace-native (toast-only, never pushed to Google).
  // `when` is the relative-time label the panel/toast display; the
  // client re-derives it on its own polling tick if needed. `urgent`
  // is true for anything due within the next 30 minutes so the panel
  // can tint it amber.
  // [reminder-tz-diag] TEMP — remove once Andrew confirms reminder times
  // land correctly in prod. The Upcoming list keeps only reminders at or
  // after `now`; this compares ABSOLUTE instants (both UTC under the
  // hood), so there is no ET/UTC boundary bug here — a correctly-timed
  // future reminder appears. The 4 PM skewed reminder was dropped only
  // because Item A stored it in the past.
  // eslint-disable-next-line no-console
  console.log("[reminder-tz-diag] upcoming-filter", {
    nowUtc: now.toISOString(),
    nowEastern: now.toLocaleString("en-US", { timeZone: "America/New_York" }),
    total: reminderRows.length,
    future: reminderRows.filter((r) => r.reminderAt.getTime() >= now.getTime()).length,
  });
  const reminders: CalendarReminder[] = reminderRows
    .filter((r) => r.reminderAt.getTime() >= now.getTime())
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      title: r.title,
      reminderAt: r.reminderAt,
      when: formatRelative(r.reminderAt, now),
      abs: formatAbsolute(r.reminderAt),
      source: "Ace",
      urgent: r.reminderAt.getTime() - now.getTime() <= 30 * 60 * 1000,
      notifyLeadsMin: r.notifyLeadsMin,
    }));

  return (
    <CalendarView
      initialDate={now}
      events={allEvents}
      latestSyncedAt={latestSyncedAt}
      teamMembers={teamMembers}
      reminders={reminders}
    />
  );
}
