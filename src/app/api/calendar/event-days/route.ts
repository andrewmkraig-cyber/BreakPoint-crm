import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// GET /api/calendar/event-days?month=YYYY-MM — feeds the TopBar
// calendar mini-popover with the set of days in the requested month
// that have at least one non-cancelled CalendarEvent for the current
// org. The popover renders a small brand-green dot under each
// matching date.
//
// Days are reported in America/New_York (the desk's working zone), so
// an event that starts 8pm ET on the 14th doesn't drift onto the 15th
// when the server reads its UTC startTime.

export const dynamic = "force-dynamic";

const ZONE = "America/New_York";

function parseMonth(raw: string | null): { year: number; month0: number } | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month0: month - 1 };
}

function formatYmdInZone(instant: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = parseMonth(new URL(req.url).searchParams.get("month"));
  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "month query param required as YYYY-MM" },
      { status: 400 },
    );
  }

  const org = await getCurrentOrg();
  // Generous window around the calendar month so the day-bucketing in
  // ET catches events that fall near month boundaries. The output set
  // is filtered to the requested month label after timezone mapping.
  const monthStartUtc = new Date(Date.UTC(parsed.year, parsed.month0, 1));
  const monthEndUtc = new Date(Date.UTC(parsed.year, parsed.month0 + 1, 2));
  const lookbackUtc = new Date(monthStartUtc.getTime() - 24 * 60 * 60 * 1000);

  const rows = await prisma.calendarEvent.findMany({
    where: {
      organizationId: org.id,
      status: { not: "CANCELLED" },
      startTime: { gte: lookbackUtc, lt: monthEndUtc },
    },
    select: { startTime: true },
  });

  const monthPrefix = `${parsed.year}-${String(parsed.month0 + 1).padStart(2, "0")}`;
  const days = new Set<string>();
  for (const r of rows) {
    const ymd = formatYmdInZone(r.startTime);
    if (ymd.startsWith(monthPrefix)) days.add(ymd);
  }

  return NextResponse.json({ ok: true, days: Array.from(days).sort() });
}
