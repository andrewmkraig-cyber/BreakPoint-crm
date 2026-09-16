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
// scheduled billing event (invoice, installment or fee total). Drives the
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
  let earliest = events[0].scheduledAt;
  let latest = events[0].scheduledAt;
  for (const e of events) {
    if (e.scheduledAt < earliest) earliest = e.scheduledAt;
    if (e.scheduledAt > latest) latest = e.scheduledAt;
  }
  return { earliest, latest };
}

export async function getPeriodJumpOptions(
  organizationId: string,
  now: Date = new Date(),
): Promise<PeriodJumpOption[]> {
  return buildPeriodJumpOptions(await getBillingPeriodBounds(organizationId), now);
}
