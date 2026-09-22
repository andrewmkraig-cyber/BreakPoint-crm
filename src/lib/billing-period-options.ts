import "server-only";

import { prisma } from "@/lib/prisma";
import { getBillingEventsForRange } from "@/lib/billing-events";
import {
  LIFETIME_END,
  LIFETIME_START,
  buildPeriodJumpOptions,
  type PeriodJumpOption,
} from "@/lib/time-range";

// The span of dates that carry billing for an org: the earliest and latest
// BOOKED billing event (by placement start date, the same field the
// Billing Tower windows on). Drives the
// jump-to-period lists on Clubhouse, Metrics, Placements and Goals so any
// quarter or year with revenue on it is one pick away, future ones
// included.
export async function getBillingPeriodBounds(
  organizationId: string,
): Promise<{ earliest: Date; latest: Date } | null> {
  const events = await getBillingEventsForRange(
    organizationId,
    LIFETIME_START,
    LIFETIME_END,
    prisma,
  );
  if (events.length === 0) return null;
  let earliest = events[0].bookedAt;
  let latest = events[0].bookedAt;
  for (const e of events) {
    if (e.bookedAt < earliest) earliest = e.bookedAt;
    if (e.bookedAt > latest) latest = e.bookedAt;
  }
  return { earliest, latest };
}

export async function getPeriodJumpOptions(
  organizationId: string,
  now: Date = new Date(),
): Promise<PeriodJumpOption[]> {
  return buildPeriodJumpOptions(await getBillingPeriodBounds(organizationId), now);
}
