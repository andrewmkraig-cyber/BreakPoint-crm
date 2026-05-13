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

function formatAbsolute(target: Date): string {
  return target.toLocaleString(undefined, {
    weekday: "short",
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

  const [rows, memberships, reminderRows, eventLinkedReminders] = await Promise.all([
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
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.aceReminder.findMany({
      where: {
        organizationId: org.id,
        dismissed: false,
        reminderAt: { gte: now },
      },
      orderBy: { reminderAt: "asc" },
      take: 10,
    }),
    // Event-linked reminders — used to set the drawer's "Ace
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
  ]);

  const eventsWithReminders = new Set(
    eventLinkedReminders
      .map((r) => r.calendarEventId)
      .filter((id): id is string => id != null),
  );

  // Team-member id is the normalized owner key ("ak", "austin",
  // …) — NOT the user.id cuid. Both this list and event.ownerId run
  // through the same helper so the left-rail toggle and the event
  // filter agree on what "Austin" means.
  const teamMembers: CalendarTeamMember[] = memberships.map((m) => ({
    id: ownerKeyForPerson({ name: m.user.name, email: m.user.email }),
    name: m.user.name ?? m.user.email ?? "Member",
    initials: initialsFor(m.user.name, m.user.email),
    color: colorFor(m.user.id),
    self: selfEmail !== null && m.user.email?.toLowerCase() === selfEmail,
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
  // Keep the row whose ownerKey is self if present — that's the copy
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
    // across renders. Self first, then alpha — matches how the rail
    // lists members.
    const ownerKeys = Array.from(keys).sort((a, b) => {
      if (selfKey) {
        if (a === selfKey) return -1;
        if (b === selfKey) return 1;
      }
      return a.localeCompare(b);
    });
    // Check every row in the dedup group — a reminder might be linked
    // to either Andrew's copy or Austin's copy of the same event.
    const reminderEnabled = groupRows.some((r) => eventsWithReminders.has(r.id));
    // Recruiter-chosen type wins over the title-based heuristic. The
    // override is mirrored to every row in the group on save, so any
    // dedup copy is a valid source.
    const overrideType = groupRows
      .map((r) => r.typeOverride as CalendarEventType | null)
      .find((t): t is CalendarEventType => t != null);
    return {
      id: row.id,
      title: row.title,
      startTime: row.startTime,
      endTime: row.endTime,
      allDay: row.allDay,
      type: overrideType ?? deriveType(row.title, row.calendarName),
      meta: row.description ?? undefined,
      guests,
      location: row.location ?? undefined,
      ownerKeys,
      jobId: row.jobId ?? undefined,
      candidateId: row.candidateId ?? undefined,
      clientId: row.clientId ?? undefined,
      calendarName: row.calendarName,
      calendarColor: row.calendarColor ?? undefined,
      meetLink: row.meetLink ?? undefined,
      htmlLink: row.htmlLink ?? undefined,
      reminderEnabled,
    };
  });

  const latestSyncedAt = rows.reduce<Date | null>((acc, row) => {
    if (!acc || row.syncedAt > acc) return row.syncedAt;
    return acc;
  }, null);

  // Reminders are Ace-native (toast-only, never pushed to Google).
  // `when` is the relative-time label the panel/toast display; the
  // client re-derives it on its own polling tick if needed. `urgent`
  // is true for anything due within the next 30 minutes so the panel
  // can tint it amber.
  const reminders: CalendarReminder[] = reminderRows.map((r) => ({
    id: r.id,
    title: r.title,
    reminderAt: r.reminderAt,
    when: formatRelative(r.reminderAt, now),
    abs: formatAbsolute(r.reminderAt),
    source: "Ace",
    urgent: r.reminderAt.getTime() - now.getTime() <= 30 * 60 * 1000,
  }));

  return (
    <CalendarView
      initialDate={now}
      events={events}
      latestSyncedAt={latestSyncedAt}
      teamMembers={teamMembers}
      reminders={reminders}
    />
  );
}
