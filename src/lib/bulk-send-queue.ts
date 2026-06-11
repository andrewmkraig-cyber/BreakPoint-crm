import "server-only";
import { prisma } from "@/lib/prisma";
import { zonedWallTimeToUtc } from "@/lib/timezone";

// ----------------------------------------------------------------------
// Bulk send queue scheduler.
//
// The "Send to N candidates" button no longer blasts every email at once.
// Instead each candidate becomes one ScheduledEmail row with a staggered
// scheduledSendAt, and the existing per-minute cron (/api/cron/scheduled-
// send) fires them one at a time. That makes the throttle fully server-
// side: it keeps sending even if the browser tab closes, never uses a
// client setTimeout, and survives a deploy.
//
// computeBulkSchedule owns the timing math. It guarantees:
//  - APPEND, NEVER PARALLEL: a new batch starts AFTER the latest pending
//    bulk row's scheduledSendAt, so a second batch queued while a first is
//    still draining extends the single timeline rather than racing it.
//  - SPACING + JITTER: emails are spacingMinutes apart, each gap randomized
//    +/- 20% so the cadence doesn't look robotic.
//  - DAILY CAP: at most `dailyCap` bulk emails land on any one Eastern
//    calendar day (counting rows already queued/sent that day). Overflow
//    rolls to the next ET day starting at 8am.
//
// Single-sender today: every row sends from the user's own Gmail (stored
// as sendAsEmail on the row). When real domain rotation is added later,
// only the sender assigned per row changes - this timing layer is unaffected.
// ----------------------------------------------------------------------

const ET = "America/New_York";

// Eastern calendar Y/M/D for an absolute instant.
function etDateParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) };
}

// "YYYY-MM-DD" in Eastern. Sorts lexically the same as chronologically,
// so string compare === day compare.
export function etDayKey(date: Date): string {
  const { y, m, d } = etDateParts(date);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The instant of 8:00am Eastern on the calendar day AFTER `date`'s ET day.
// Date.UTC handles month/year rollover; zonedWallTimeToUtc handles DST.
function nextEtDay8am(date: Date): Date {
  const { y, m, d } = etDateParts(date);
  const nextCal = new Date(Date.UTC(y, m - 1, d + 1));
  return zonedWallTimeToUtc(
    nextCal.getUTCFullYear(),
    nextCal.getUTCMonth() + 1,
    nextCal.getUTCDate(),
    8,
    0,
    ET,
  );
}

// Eastern midnight (start of day) for an instant - the lower bound for the
// daily-cap count query so we only load today + future rows.
export function startOfEtDay(date: Date): Date {
  const { y, m, d } = etDateParts(date);
  return zonedWallTimeToUtc(y, m, d, 0, 0, ET);
}

// One spacing gap with +/- 20% randomization. 0 spacing => 0 (instant mode).
function jitteredGap(spacingMs: number): number {
  if (spacingMs <= 0) return 0;
  return Math.round(spacingMs * (0.8 + Math.random() * 0.4));
}

export type BulkScheduleResult = {
  // One absolute send instant per recipient, in order.
  sendTimes: Date[];
  // How many of those land on an ET day later than today (rolled past the
  // daily cap). Surfaced in the queue status so the recruiter knows some
  // sends slipped to tomorrow.
  overflowCount: number;
};

// Build the staggered schedule for a new batch of `count` recipients.
export async function computeBulkSchedule(params: {
  userId: string;
  count: number;
  spacingMinutes: number;
  dailyCap: number;
  now?: Date;
}): Promise<BulkScheduleResult> {
  const now = params.now ?? new Date();
  const spacingMs = Math.max(0, params.spacingMinutes) * 60_000;
  const cap = Math.max(1, params.dailyCap);

  if (params.count <= 0) return { sendTimes: [], overflowCount: 0 };

  // Pre-load how many bulk emails are already committed to each ET day
  // (pending OR already sent) so the cap is enforced across batches, not
  // just within this one.
  const existing = await prisma.scheduledEmail.findMany({
    where: {
      userId: params.userId,
      source: "bulk_email",
      status: { in: ["SCHEDULED", "SENT"] },
      scheduledSendAt: { gte: startOfEtDay(now) },
    },
    select: { scheduledSendAt: true },
  });
  const dayCounts = new Map<string, number>();
  for (const r of existing) {
    const k = etDayKey(r.scheduledSendAt);
    dayCounts.set(k, (dayCounts.get(k) ?? 0) + 1);
  }

  // Tail of the existing pending queue. A new batch appends after it so it
  // never runs in parallel with a draining batch and never resets the timer.
  const tail = await prisma.scheduledEmail.findFirst({
    where: { userId: params.userId, source: "bulk_email", status: "SCHEDULED" },
    orderBy: { scheduledSendAt: "desc" },
    select: { scheduledSendAt: true },
  });

  let cursor = tail
    ? new Date(tail.scheduledSendAt.getTime() + jitteredGap(spacingMs))
    : new Date(now);
  if (cursor.getTime() < now.getTime()) cursor = new Date(now);

  const todayKey = etDayKey(now);
  const sendTimes: Date[] = [];
  let overflowCount = 0;

  for (let i = 0; i < params.count; i++) {
    // Roll forward over any ET day that is already at the cap. cap >= 1
    // guarantees each day absorbs at least one, so this always terminates;
    // the guard is a backstop against a pathological input.
    let dayKey = etDayKey(cursor);
    let guard = 0;
    while ((dayCounts.get(dayKey) ?? 0) >= cap && guard < 3660) {
      cursor = nextEtDay8am(cursor);
      dayKey = etDayKey(cursor);
      guard++;
    }
    sendTimes.push(new Date(cursor));
    dayCounts.set(dayKey, (dayCounts.get(dayKey) ?? 0) + 1);
    if (dayKey > todayKey) overflowCount++;
    cursor = new Date(cursor.getTime() + jitteredGap(spacingMs));
  }

  return { sendTimes, overflowCount };
}
