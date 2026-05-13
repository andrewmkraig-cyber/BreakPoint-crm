import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import type {
  CalendarEvent,
  CalendarEventType,
} from "@/lib/calendar/types";
import { prisma } from "@/lib/prisma";

import { CalendarView } from "./calendar-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Calendar · Ace",
};

type AttendeeJson = { displayName?: string; email?: string };

function deriveType(title: string, calendarName: string): CalendarEventType {
  const lcCal = calendarName.toLowerCase();
  if (lcCal.includes("andrew@breakpointtalent") || lcCal.includes("andrew")) {
    return "personal";
  }
  const lcTitle = title.toLowerCase();
  if (lcTitle.includes("interview")) return "interview";
  if (lcTitle.includes("call") || lcTitle.includes("meeting")) return "client";
  return "other";
}

function deriveOwner(calendarName: string): string {
  const lc = calendarName.toLowerCase();
  if (lc.includes("austin@")) return "austin";
  return "ak";
}

export default async function CalendarPage() {
  const org = await getCurrentOrg();

  const now = new Date();
  const windowMs = 90 * 24 * 60 * 60 * 1000;

  const rows = await prisma.calendarEvent.findMany({
    where: {
      organizationId: org.id,
      status: { not: "CANCELLED" },
      startTime: {
        gte: new Date(now.getTime() - windowMs),
        lte: new Date(now.getTime() + windowMs),
      },
    },
    orderBy: { startTime: "asc" },
  });

  const events: CalendarEvent[] = rows.map((row) => {
    const attendees = (row.attendees as AttendeeJson[] | null) ?? null;
    const guests = attendees
      ? attendees
          .map((a) => (a.displayName ?? a.email ?? "").trim())
          .filter((s) => s.length > 0)
      : undefined;

    return {
      id: row.id,
      title: row.title,
      startTime: row.startTime,
      endTime: row.endTime,
      allDay: row.allDay,
      type: deriveType(row.title, row.calendarName),
      meta: row.description ?? undefined,
      guests,
      location: row.location ?? undefined,
      ownerId: deriveOwner(row.calendarName),
      jobId: row.jobId ?? undefined,
      candidateId: row.candidateId ?? undefined,
      clientId: row.clientId ?? undefined,
      calendarName: row.calendarName,
      calendarColor: row.calendarColor ?? undefined,
    };
  });

  const latestSyncedAt = rows.reduce<Date | null>((acc, row) => {
    if (!acc || row.syncedAt > acc) return row.syncedAt;
    return acc;
  }, null);

  return (
    <CalendarView
      initialDate={now}
      events={events}
      latestSyncedAt={latestSyncedAt}
    />
  );
}
