// Actuals for every GoalMetric. Server-side only, no UI.
//
// One resolver per metric, each org-scoped (architecture rule 8) and each
// returning `number | null`. NULL AND ZERO ARE DIFFERENT ANSWERS: zero
// means "we measured, and nothing happened"; null means "Ace cannot
// measure this", and a caller must render it as "not tracked", never as a
// miss. Every unsupported case below returns null on purpose rather than
// shipping a number that undercounts.
//
// DAY BOUNDARIES ARE EASTERN. Vercel runs UTC, so an unanchored range puts
// 8pm ET on the wrong side of a quarter line (7pm during EST). Bounds are
// re-anchored through `etWindow` before any query runs, using the same
// Intl approach as src/lib/week.ts and the dashboard's goal-pacing card.
//
// WHAT A GOAL'S periodStart / periodEnd ACTUALLY ARE: calendar-date
// markers, written as UTC midnight / UTC end-of-day by
// scripts/seed-goals-2026.ts. They are NOT absolute instants to be read in
// ET - 2026-01-01T00:00:00Z read as an ET wall clock is 7pm on Dec 31, and
// treating it that way would pull the last evening of the prior quarter
// into Q1. So `etWindow` reads each bound's UTC calendar date and anchors
// THAT date to ET midnight. Passing an already-ET-anchored start back
// through is a no-op, so the helper is safe to apply more than once.
import { GoalMetric } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { DEFAULT_TIMEZONE, zonedWallTimeToUtc } from "@/lib/timezone";

// Placement stages excluded from every "this really happened" count. Kept
// in sync with the PlacementStage union in src/lib/placements.ts - the
// `stage` column is a loose String and the SCHEMA COMMENT on it is stale
// (it names only offer / pending_start / hired; the real union has ten
// values).
const DEAD_PLACEMENT_STAGES = ["cancelled", "rejected"] as const;
const CANCELLED_PLACEMENT_STAGE = "cancelled";

// Interview.status is a loose String: scheduled | completed | cancelled |
// rescheduled. Only cancelled is excluded - a completed interview still
// happened, and a rescheduled row still represents a real interview.
const CANCELLED_INTERVIEW_STATUS = "cancelled";

// Invoice statuses that count as billed. VOID is excluded from billed AND
// collected; a voided invoice is money that was never earned.
const BILLED_INVOICE_STATUSES = ["SENT", "PAID"] as const;

export type MetricWindow = {
  // ET midnight of the window's first day, as an absolute instant.
  readonly start: Date;
  // ET midnight of the day AFTER the window's last day. EXCLUSIVE, so
  // every query below is `gte: start, lt: endExclusive` and no row can
  // fall in two adjacent periods.
  readonly endExclusive: Date;
};

function utcCalendarDate(d: Date): { y: number; m: number; day: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// The absolute instant at which the given ET calendar date begins.
function etMidnight(y: number, m: number, day: number): Date {
  return zonedWallTimeToUtc(y, m, day, 0, 0, DEFAULT_TIMEZONE);
}

export function etWindow(rangeStart: Date, rangeEnd: Date): MetricWindow {
  const s = utcCalendarDate(rangeStart);
  const e = utcCalendarDate(rangeEnd);
  // Date.UTC normalizes the day overflow (Dec 31 + 1 -> Jan 1).
  const dayAfterEnd = new Date(Date.UTC(e.y, e.m - 1, e.day + 1));
  const a = utcCalendarDate(dayAfterEnd);
  return {
    start: etMidnight(s.y, s.m, s.day),
    endExclusive: etMidnight(a.y, a.m, a.day),
  };
}

// Whole ET calendar days from `from` up to and including `to`, where both
// are TRUE INSTANTS (a resolved window bound, or `now`). Used by the
// pacing engine; lives here so there is exactly one ET-day implementation
// for the goals code.
//
// Do NOT hand this a raw goal periodStart/periodEnd - those are UTC
// calendar-date markers, and reading 2026-01-01T00:00Z as an ET wall clock
// lands on Dec 31. Run them through `etWindow` first, or use
// `utcMarkerDaysInclusive` if you need to count markers as markers.
export function etDaysInclusive(from: Date, to: Date): number {
  const parts = (d: Date) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
    const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"));
  };
  return Math.round((parts(to) - parts(from)) / 86_400_000) + 1;
}

// Whole calendar days between two UTC calendar-date MARKERS, inclusive.
// The marker-space twin of etDaysInclusive: it never re-reads the dates in
// another zone, so a DST boundary inside the span cannot shift the count.
export function utcMarkerDaysInclusive(from: Date, to: Date): number {
  const a = utcCalendarDate(from);
  const b = utcCalendarDate(to);
  const ms = Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day);
  return Math.round(ms / 86_400_000) + 1;
}

// Shift a UTC calendar-date marker by whole days, staying in marker space.
export function shiftUtcMarker(marker: Date, days: number): Date {
  const { y, m, day } = utcCalendarDate(marker);
  return new Date(Date.UTC(y, m - 1, day + days));
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  return Number(v);
}

// ---------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------
// Each model gets scoped by the ownership field IT ALREADY HAS. Nothing
// below invents a path:
//
//   Invoice   -> client.ownerId   (Client.ownerId is the account owner;
//                                  its schema comment says jobs and
//                                  pipeline inherit it. 11/11 live
//                                  invoices carry a clientId.)
//   Placement -> client.ownerId   (same inheritance; 143/143 carry one)
//   Client    -> ownerId          (the column itself)
//   Interview -> createdById      (NOT client.ownerId: only 11 of 78 live
//                                  interviews have a clientId, so owner-
//                                  scoping through the client would drop
//                                  67 of them. createdById is on 100%.)
//   ActionLog -> userId           (who performed the submit)
//   BDRun / BDActivity -> NOTHING. Neither table records a user, so
//                                  owner-scoped BD goals are unsupported.
//
// One live client currently has a null ownerId, so its records are
// invisible to every owner-scoped query. That is correct behaviour for an
// unclaimed account, not a bug to paper over.

const OWNERSHIP_FIELD: Record<GoalMetric, string | null> = {
  REVENUE: "Invoice.client.ownerId",
  PLACEMENTS: "Placement.client.ownerId",
  SIGNED_CLIENTS: "Client.ownerId",
  AVG_DEAL_SIZE: "Invoice.client.ownerId + Placement.client.ownerId",
  INTERVIEWS: "Interview.createdById",
  SUBMITTALS: "ActionLog.userId",
  BD_CONTACTS_ENROLLED: null,
  BD_REPLIES: null,
  MANUAL: "GoalActualEntry (scoped by goalId, so the goal's own owner)",
};

export function ownershipFieldFor(metric: GoalMetric): string | null {
  return OWNERSHIP_FIELD[metric];
}

// ---------------------------------------------------------------------
// REVENUE
// ---------------------------------------------------------------------

export type RevenueResult = {
  // Invoice.feeAmount for SENT + PAID invoices, dated by sentAt.
  readonly billed: number;
  // Invoice.feeAmount for PAID invoices only, dated by paidAt.
  readonly collected: number;
};

// Both figures in one call so they can never be resolved from two
// differently-filtered queries and disagree.
//
// The two are dated by DIFFERENT columns on purpose: an invoice sent in Q1
// and paid in Q2 is Q1 billed and Q2 collected. VOID is excluded from
// both, and so is any invoice hanging off a cancelled placement. Retained
// invoices carry no placementId at all, so the exclusion is written as
// "no placement, OR a placement that is not cancelled" rather than a
// relation filter that would silently drop them.
export async function resolveRevenue(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<RevenueResult> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);

  const notOnCancelledPlacement = {
    OR: [
      { placementId: null },
      { placement: { stage: { not: CANCELLED_PLACEMENT_STAGE } } },
    ],
  };
  const ownerClause = ownerUserId ? [{ client: { ownerId: ownerUserId } }] : [];

  const [billedAgg, collectedAgg] = await Promise.all([
    prisma.invoice.aggregate({
      _sum: { feeAmount: true },
      where: {
        organizationId,
        status: { in: [...BILLED_INVOICE_STATUSES] },
        sentAt: { gte: start, lt: endExclusive },
        AND: [notOnCancelledPlacement, ...ownerClause],
      },
    }),
    prisma.invoice.aggregate({
      _sum: { feeAmount: true },
      where: {
        organizationId,
        status: "PAID",
        paidAt: { gte: start, lt: endExclusive },
        AND: [notOnCancelledPlacement, ...ownerClause],
      },
    }),
  ]);

  return {
    billed: toNumber(billedAgg._sum.feeAmount),
    collected: toNumber(collectedAgg._sum.feeAmount),
  };
}

// The single number a REVENUE goal is paced against.
//
// BILLED, not collected - the same basis the dashboard's Goal Pacing card
// settled on (Ace fix 2026-05-26, documented in goal-pacing.tsx): the
// recruiter's question is "did I earn enough work this quarter", not "did
// the cash land". Change it HERE if that ever flips, so the report, the
// pacing engine and any future UI move together.
export function revenueHeadline(r: RevenueResult): number {
  return r.billed;
}

// ---------------------------------------------------------------------
// PLACEMENTS / SIGNED_CLIENTS / AVG_DEAL_SIZE
// ---------------------------------------------------------------------

export async function resolvePlacements(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  return prisma.placement.count({
    where: {
      organizationId,
      placedAt: { gte: start, lt: endExclusive },
      stage: { notIn: [...DEAD_PLACEMENT_STAGES] },
      ...(ownerUserId ? { client: { ownerId: ownerUserId } } : {}),
    },
  });
}

// Distinct clients whose fee agreement was signed in the window. Counted
// off Client rows, so "distinct" is structural - one client cannot be
// counted twice.
export async function resolveSignedClients(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  return prisma.client.count({
    where: {
      organizationId,
      feeAgreementSignedAt: { gte: start, lt: endExclusive },
      ...(ownerUserId ? { ownerId: ownerUserId } : {}),
    },
  });
}

// Billed revenue over placements for the SAME window, computed from the
// two resolvers above so it can never disagree with them.
//
// Returns null - never 0 - when there were no placements. A zero average
// would read as "our deals are worthless"; null reads as "no deals yet",
// which is the truth.
export async function resolveAvgDealSize(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number | null> {
  const [revenue, placements] = await Promise.all([
    resolveRevenue(organizationId, rangeStart, rangeEnd, ownerUserId),
    resolvePlacements(organizationId, rangeStart, rangeEnd, ownerUserId),
  ]);
  if (placements === 0) return null;
  return revenueHeadline(revenue) / placements;
}

// ---------------------------------------------------------------------
// INTERVIEWS
// ---------------------------------------------------------------------

// Dated by scheduledAt (when the interview happens), not createdAt (when
// it was booked) - an INTERVIEWS goal for Q1 means interviews that took
// place in Q1.
export async function resolveInterviews(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  return prisma.interview.count({
    where: {
      organizationId,
      scheduledAt: { gte: start, lt: endExclusive },
      status: { not: CANCELLED_INTERVIEW_STATUS },
      ...(ownerUserId ? { createdById: ownerUserId } : {}),
    },
  });
}

// ---------------------------------------------------------------------
// SUBMITTALS
// ---------------------------------------------------------------------

// Sourced from ActionLog, NOT from Placement.
//
// Placement.stageMovedAt only ever describes the CURRENT stage, so it
// cannot date a past submitted -> interviewing transition; a candidate who
// has since moved on carries no record of when they were submitted. (And
// stageMovedAt is trigger-maintained - never written from app code.)
// ActionLog is an append-only event log that already records the real
// event: actionType "submit", a real createdAt, and the acting userId.
// The dashboard funnel in src/app/dashboard/scoreboard-data.ts reads the
// same rows, so this metric and the Scoreboard agree by construction.
//
// De-duped by candidate + job because one submittal can write more than
// one row (a resubmit, or a submittal emailed to several client contacts).
// On live data that is 100 raw rows -> 98 real submittals.
export async function resolveSubmittals(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  const rows = await prisma.actionLog.findMany({
    where: {
      organizationId,
      actionType: "submit",
      createdAt: { gte: start, lt: endExclusive },
      ...(ownerUserId ? { userId: ownerUserId } : {}),
    },
    select: { subjectId: true, metadata: true },
  });

  const seen = new Set<string>();
  for (const row of rows) {
    const md = (row.metadata ?? {}) as Record<string, unknown>;
    // The `jobRfId` fallback is DELIBERATE and load-bearing, and it is why
    // this file raises the RfId Step 0 count from 83 to 84. It is not a new
    // RecruiterFlow dependency: nothing here reads RF, calls RF, or falls
    // back to RF as a data source. It reads one legacy identifier out of
    // Ace's OWN append-only ActionLog, because 12 of the 100 live submit
    // rows were written in April 2026 with `jobRfId` set and `jobId` null.
    // Without this line those 12 rows all collapse into one "unknown-job"
    // bucket per candidate and the 2026 submittal count drops from 98 to
    // 94 - a silent undercount concentrated entirely in Q2.
    //
    // Do NOT "clean this up" to satisfy the grep. Past log rows are
    // immutable; the only way to remove the read honestly is to backfill
    // `jobId` onto those 12 rows first.
    const job = md.jobId ?? md.jobRfId ?? "unknown-job";
    seen.add(`${row.subjectId}|${String(job)}`);
  }
  return seen.size;
}

// Raw row count behind resolveSubmittals, so a report can show the
// de-duplication instead of asserting it.
export async function countRawSubmitActions(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  return prisma.actionLog.count({
    where: {
      organizationId,
      actionType: "submit",
      createdAt: { gte: start, lt: endExclusive },
      ...(ownerUserId ? { userId: ownerUserId } : {}),
    },
  });
}

// ---------------------------------------------------------------------
// BD
// ---------------------------------------------------------------------

// Contacts pushed into an Apollo sequence, summed from BDRun.enrolledCount
// over runs that finished in the window.
//
// Why BDRun and not BDActivity: the ENROLL rows on BDActivity are ONE ROW
// PER RUN with the contact count buried in `metadata.contacts` - counting
// those rows counts runs, not contacts (39 rows describing 266 contacts on
// live data). BDRun.enrolledCount is a real Int column incremented per
// contact, and the two agree exactly (266 = 266), so the typed column
// wins. CampaignEvent, the other candidate, is an empty table.
//
// Dated by completedAt: every live run with enrolledCount > 0 has one
// (0 exceptions), and a run's contacts land when the run finishes.
//
// Returns null for owner-scoped goals: no BD table records a user.
export async function resolveBdContactsEnrolled(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number | null> {
  if (ownerUserId) return null;
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  const agg = await prisma.bDRun.aggregate({
    _sum: { enrolledCount: true },
    where: {
      organizationId,
      completedAt: { gte: start, lt: endExclusive },
    },
  });
  return toNumber(agg._sum.enrolledCount);
}

// UNSUPPORTED IN V1 - always null.
//
// The only table shaped to hold a BD reply is BDActivity kind=REPLY, fed
// by /api/webhooks/apollo. That webhook has NEVER written a row: live
// BDActivity holds 39 ENROLL rows and zero of every other kind, which
// tracks with the standing rule that the Apollo sequence "Activate" toggle
// stays off. Counting it would return 0 for every period forever, and a
// goal reading 0 looks like failure rather than like missing
// instrumentation - the exact undercount this is meant to avoid.
//
// InstantlyReply is NOT this metric. It holds 80 rows (27 genuine, after
// excluding our own senders and auto-replies) but it is the Instantly
// channel, which is deliberately bucketed under MANUAL goals for now.
// Wiring it in here would silently redefine what BD_REPLIES counts.
//
// To turn this on once Apollo replies are actually arriving, replace the
// early return with the commented query below and verify the row count
// first.
export async function resolveBdReplies(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<number | null> {
  // The signature stays identical to every other resolver so the
  // dispatcher can spread one argument tuple, and so switching this on is
  // a one-line change rather than a refactor. Nothing is read yet.
  void organizationId;
  void rangeStart;
  void rangeEnd;
  void ownerUserId;
  return null;
  // To enable, delete the `return null` above and the four voids, then:
  // const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  // return prisma.bDActivity.count({
  //   where: {
  //     organizationId,
  //     kind: "REPLY",
  //     occurredAt: { gte: start, lt: endExclusive },
  //   },
  // });
}

// ---------------------------------------------------------------------
// MANUAL
// ---------------------------------------------------------------------

// Sum of the goal's own hand-entered actuals. Scoped by goalId as well as
// organizationId, so it needs the goal, not just an owner - a MANUAL goal
// counts only what was entered against IT.
export async function resolveManual(
  organizationId: string,
  goalId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<number> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  const agg = await prisma.goalActualEntry.aggregate({
    _sum: { value: true },
    where: {
      organizationId,
      goalId,
      entryDate: { gte: start, lt: endExclusive },
    },
  });
  return toNumber(agg._sum.value);
}

// ---------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------

export type MetricResult = {
  // The number the goal is paced against. Null means not measurable.
  readonly value: number | null;
  // Set only for REVENUE and AVG_DEAL_SIZE, which both read invoices.
  readonly revenue?: RevenueResult;
  // Why value is null, for a report or a UI to show instead of a number.
  readonly unsupportedReason?: string;
};

export async function resolveMetric(input: {
  organizationId: string;
  metric: GoalMetric;
  rangeStart: Date;
  rangeEnd: Date;
  ownerUserId: string | null;
  // Required when metric is MANUAL.
  goalId?: string | null;
}): Promise<MetricResult> {
  const { organizationId, metric, rangeStart, rangeEnd, ownerUserId, goalId } = input;
  const args = [organizationId, rangeStart, rangeEnd, ownerUserId] as const;

  switch (metric) {
    case GoalMetric.REVENUE: {
      const revenue = await resolveRevenue(...args);
      return { value: revenueHeadline(revenue), revenue };
    }
    case GoalMetric.PLACEMENTS:
      return { value: await resolvePlacements(...args) };
    case GoalMetric.SIGNED_CLIENTS:
      return { value: await resolveSignedClients(...args) };
    case GoalMetric.AVG_DEAL_SIZE: {
      const [revenue, value] = await Promise.all([
        resolveRevenue(...args),
        resolveAvgDealSize(...args),
      ]);
      return {
        value,
        revenue,
        ...(value === null ? { unsupportedReason: "no placements in this period" } : {}),
      };
    }
    case GoalMetric.INTERVIEWS:
      return { value: await resolveInterviews(...args) };
    case GoalMetric.SUBMITTALS:
      return { value: await resolveSubmittals(...args) };
    case GoalMetric.BD_CONTACTS_ENROLLED: {
      const value = await resolveBdContactsEnrolled(...args);
      return {
        value,
        ...(value === null
          ? { unsupportedReason: "BD tables record no user, so owner-scoped BD goals cannot be measured" }
          : {}),
      };
    }
    case GoalMetric.BD_REPLIES:
      return {
        value: await resolveBdReplies(...args),
        unsupportedReason:
          "the Apollo reply webhook has never written a row; counting it would report 0 forever",
      };
    case GoalMetric.MANUAL: {
      if (!goalId) {
        return { value: null, unsupportedReason: "a MANUAL goal must be resolved with its own goalId" };
      }
      return { value: await resolveManual(organizationId, goalId, rangeStart, rangeEnd) };
    }
  }
}
