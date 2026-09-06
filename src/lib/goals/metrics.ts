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
import { GoalMetric, GoalPeriod } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  etDayFractionElapsed,
  etDaysInclusive,
  etWindow,
  shiftUtcMarker,
  utcMarkerDaysInclusive,
  type MetricWindow,
} from "@/lib/goals/et-window";

// Re-exported so every existing `from "@/lib/goals/metrics"` import keeps
// working. Anything running in a CLIENT component must import them from
// "@/lib/goals/et-window" directly - this module pulls in prisma.
export {
  etDayFractionElapsed,
  etDaysInclusive,
  etWindow,
  shiftUtcMarker,
  utcMarkerDaysInclusive,
};
export type { MetricWindow };

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

// Three tiers of the same money, widest to narrowest. In normal operation
// earned >= billed >= collected: work is done, then invoiced, then paid.
export type RevenueResult = {
  // Work the desk has closed in the window, whether or not an invoice
  // exists yet - the widest tier. Two sources, which cannot overlap:
  // Placement.feeTotal for placements PLACED in the window (retained
  // placements excluded), plus RetainedSearch.totalAmount for engagements
  // BOOKED in the window. See retainedEarnedWhere.
  readonly earned: number;
  // Invoice.feeAmount for SENT + PAID invoices, dated by sentAt.
  readonly billed: number;
  // Invoice.feeAmount for PAID invoices only, dated by paidAt.
  readonly collected: number;
  // True when billed came out ABOVE earned, which should not happen. NOT
  // clamped: an invoice with no live placement behind it is a real data
  // problem (a placement cancelled after invoicing, or an invoice attached
  // to the wrong row), and silently flooring it to `earned` would hide it.
  // Callers should surface the two numbers and this flag.
  readonly billedExceedsEarned: boolean;
};

// Pure assembly, split out so the invariant is unit-testable without a
// database.
export function buildRevenueResult(
  earned: number,
  billed: number,
  collected: number,
): RevenueResult {
  return { earned, billed, collected, billedExceedsEarned: billed > earned };
}

// ---------------------------------------------------------------------
// Shared WHERE builders
// ---------------------------------------------------------------------
// The exclusion rules, as plain objects, exported for two reasons:
//   1. They become assertable in a unit test instead of only being
//      reachable through a live query.
//   2. Any surface that needs the same money sliced a different way -
//      src/lib/goals/client-leaderboard.ts groups it BY CLIENT - filters
//      through these exact objects instead of restating the rules. That is
//      what makes it impossible for the leaderboard to disagree with the
//      goal meters: there is one definition of "which placements count"
//      and one of "which invoices count", and both live here.
//
// A retained invoice carries no placementId, so the cancelled-placement
// exclusion is written as "no placement, OR a placement that is not
// cancelled" rather than a relation filter that would drop it.
function notOnCancelledPlacement() {
  return {
    OR: [
      { placementId: null },
      { placement: { stage: { not: CANCELLED_PLACEMENT_STAGE } } },
    ],
  };
}

// Invoices that count as BILLED in the window: SENT or PAID, dated by
// sentAt. VOID never counts.
export function billedInvoiceWhere(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  ownerUserId: string | null,
) {
  return {
    organizationId,
    status: { in: [...BILLED_INVOICE_STATUSES] },
    sentAt: { gte: start, lt: endExclusive },
    AND: [
      notOnCancelledPlacement(),
      ...(ownerUserId ? [{ client: { ownerId: ownerUserId } }] : []),
    ],
  };
}

// Invoices that count as COLLECTED in the window: PAID only, dated by
// paidAt. An invoice sent in Q1 and paid in Q2 is Q1 billed, Q2 collected.
export function collectedInvoiceWhere(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  ownerUserId: string | null,
) {
  return {
    organizationId,
    status: "PAID" as const,
    paidAt: { gte: start, lt: endExclusive },
    AND: [
      notOnCancelledPlacement(),
      ...(ownerUserId ? [{ client: { ownerId: ownerUserId } }] : []),
    ],
  };
}

// Placements that COUNT as placements in the window. Note this does NOT
// exclude retained placements: a retained fill is a real placement, it just
// contributes no dollars (Ace 97.0 keeps every non-dollar metric - count,
// win rate, days to fill - inclusive of them). Only `earned` excludes them.
export function placementCountWhere(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  ownerUserId: string | null,
) {
  return {
    organizationId,
    placedAt: { gte: start, lt: endExclusive },
    stage: { notIn: [...DEAD_PLACEMENT_STAGES] },
    ...(ownerUserId ? { client: { ownerId: ownerUserId } } : {}),
  };
}

// ---------------------------------------------------------------------
// Retained engagements inside `earned`
// ---------------------------------------------------------------------
// WHICH TIMESTAMP DATES A RETAINER, and why it is createdAt.
//
// RetainedSearch records totalAmount (whole USD), useInstallments, status
// (OPEN / FILLED / CLOSED_UNFILLED), a nullable placementId for the
// eventual fill, closedAt, and createdAt. There is NO signedAt column.
// The candidates, and why the others lose:
//   - closedAt    - only set when the engagement closes, so a live OPEN
//                   retainer would be invisible for months. Wrong.
//   - installment dueDate - a BILLING schedule, not an earning event.
//   - invoice sentAt - that is the definition of `billed`, not `earned`.
//   - the fill's placedAt - a retainer that closes unfilled still earned
//                   its money, and an OPEN one has no placement at all.
//   - createdAt   - the row is written when the recruiter records a
//                   committed engagement (the Send Retained Invoice flow
//                   creates it and invoices immediately after). It is the
//                   direct analogue of placedAt: the moment the deal
//                   closed. THIS IS THE ONE.
//
// THE FULL totalAmount LANDS AT ONCE, even for a staged retainer.
// Installments are a billing schedule. A contingent placement with
// custom terms earns its whole feeTotal on placedAt and bills it across
// three invoices; a retainer behaves identically, or the two kinds of
// deal would be measured on different clocks. "Part billed" changes
// `billed`, never `earned`.
//
// NO DOUBLE COUNT. Retained money enters `earned` here and ONLY here:
// earnedPlacementWhere still excludes every placement carrying a
// retainedSearchId, so a retainer that later fills contributes its
// totalAmount once from this side and zero from its placement. That
// mirrors what the rest of the app already does - Avg Fee Size in
// scoreboard-data.ts substitutes RetainedSearch.totalAmount for a
// retained placement's feeTotal for the same reason.
export function retainedEarnedWhere(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  ownedClientIds: string[] | null,
) {
  return {
    organizationId,
    createdAt: { gte: start, lt: endExclusive },
    // CLOSED_UNFILLED is deliberately included: the client paid to run the
    // search, so the money was earned whether or not it produced a hire.
    ...(ownedClientIds ? { clientId: { in: ownedClientIds } } : {}),
  };
}

// RetainedSearch carries scalar-only FKs (no Prisma relation fields), so an
// owner-scoped query cannot filter through `client: { ownerId }` the way
// Placement and Invoice do. Resolve the owned client ids first. Returns
// null when no owner scope is asked for, meaning "no clientId filter".
async function ownedClientIdsFor(
  organizationId: string,
  ownerUserId: string | null,
): Promise<string[] | null> {
  if (!ownerUserId) return null;
  const rows = await prisma.client.findMany({
    where: { organizationId, ownerId: ownerUserId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// The `earned` filter.
//
// Three exclusions, each for its own reason:
//   - cancelled / rejected: the placement did not happen.
//   - retainedSearchId != null: the money is on the RetainedSearch invoice
//     (see the note below); counting it here double-counts the retainer.
//   - owner scope, when asked for, through the client's owner.
export function earnedPlacementWhere(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  ownerUserId: string | null,
) {
  return {
    organizationId,
    placedAt: { gte: start, lt: endExclusive },
    stage: { notIn: [...DEAD_PLACEMENT_STAGES] },
    retainedSearchId: null,
    ...(ownerUserId ? { client: { ownerId: ownerUserId } } : {}),
  };
}

// All three figures in one call so they can never be resolved from
// differently-filtered queries and disagree.
//
// Each tier is dated by a DIFFERENT column on purpose: a placement made in
// Q1, invoiced in Q1 and paid in Q2 is Q1 earned, Q1 billed, Q2 collected.
// VOID is excluded from billed and collected, and so is any invoice
// hanging off a cancelled placement. Retained invoices carry no
// placementId at all, so that exclusion is written as "no placement, OR a
// placement that is not cancelled" rather than a relation filter that
// would silently drop them.
//
// EARNED reads Placement.feeTotal - the SAME column createInvoiceForPlacement
// copies into Invoice.feeAmount (src/lib/invoices.ts: `feeAmount =
// placement.feeTotal`). Reading the same field is what stops earned and
// billed from drifting apart on the same placement.
//
// RETAINED PLACEMENTS ARE EXCLUDED FROM `earned`. A retained engagement is
// billed on the RetainedSearch before any candidate exists, and the
// placement that eventually fills it contributes $0 to every other revenue
// surface in the app (Ace 97.0: `expandPlacementBillingEvents` returns []
// for a retained placement, which is what zeroes its dollars everywhere at
// once). If such a placement carries a feeTotal, counting it here would
// add the retainer a second time - once on the invoice as `billed`, once
// on the placement as `earned`. So `earned` skips any placement with a
// non-null retainedSearchId, matching what the rest of the app already
// does. Zero live placements carry one today; the guard is in place so the
// first one cannot silently inflate the number.
//
// NOTE the asymmetry this leaves: retained money reaches `billed` and
// `collected` through its invoice, but reaches `earned` through nothing at
// all, so an OPEN retained engagement reads as billed-with-no-earned. See
// resolveRevenue's caller notes - adding it would mean summing
// RetainedSearch.totalAmount, which is a separate change.
export async function resolveRevenue(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<RevenueResult> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);

  const ownedClientIds = await ownedClientIdsFor(organizationId, ownerUserId);

  const [earnedAgg, retainedAgg, billedAgg, collectedAgg] = await Promise.all([
    prisma.placement.aggregate({
      _sum: { feeTotal: true },
      where: earnedPlacementWhere(organizationId, start, endExclusive, ownerUserId),
    }),
    // Retained engagements, dated by createdAt. See retainedEarnedWhere for
    // why that timestamp and why the whole amount lands at once.
    prisma.retainedSearch.aggregate({
      _sum: { totalAmount: true },
      where: retainedEarnedWhere(organizationId, start, endExclusive, ownedClientIds),
    }),
    prisma.invoice.aggregate({
      _sum: { feeAmount: true },
      where: billedInvoiceWhere(organizationId, start, endExclusive, ownerUserId),
    }),
    prisma.invoice.aggregate({
      _sum: { feeAmount: true },
      where: collectedInvoiceWhere(organizationId, start, endExclusive, ownerUserId),
    }),
  ]);

  return buildRevenueResult(
    // Placement fees PLUS retained engagements. The two cannot overlap:
    // earnedPlacementWhere excludes every placement with a
    // retainedSearchId, so each retainer is counted exactly once.
    toNumber(earnedAgg._sum.feeTotal) + toNumber(retainedAgg._sum.totalAmount),
    toNumber(billedAgg._sum.feeAmount),
    toNumber(collectedAgg._sum.feeAmount),
  );
}

// The individual billed invoices behind `resolveRevenue(...).billed`, for
// callers that need to bucket the money over time (the pace chart) rather
// than take one total. Filtered through the SAME billedInvoiceWhere the
// aggregate uses, so a chart built from these rows always sums back to the
// headline figure.
export async function listBilledInvoices(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<Array<{ sentAt: Date; amount: number }>> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  const rows = await prisma.invoice.findMany({
    where: billedInvoiceWhere(organizationId, start, endExclusive, ownerUserId),
    select: { sentAt: true, feeAmount: true },
    orderBy: { sentAt: "asc" },
  });
  return rows
    .filter((r): r is { sentAt: Date; feeAmount: typeof r.feeAmount } => r.sentAt != null)
    .map((r) => ({ sentAt: r.sentAt, amount: toNumber(r.feeAmount) }));
}

// The individual PLACEMENTS behind `resolveRevenue(...).earned`, for
// callers that need to bucket the money over time (the pace chart) rather
// than take one total. Filtered through the SAME earnedPlacementWhere the
// aggregate uses, so a chart built from these rows always sums back to the
// headline figure.
//
// This replaced listBilledInvoices as the pace chart's source when earned
// became the pacing actual (Ace 99.0) - a chart drawn from a different
// tier than the headline would not land on the headline's number. For the
// same reason it carries RETAINED engagements too (Ace 99.2), dated by
// createdAt: leaving them out would put the curve below its own headline
// by the value of every retainer in the window.
export async function listEarnedPlacements(
  organizationId: string,
  rangeStart: Date,
  rangeEnd: Date,
  ownerUserId: string | null,
): Promise<Array<{ placedAt: Date; amount: number }>> {
  const { start, endExclusive } = etWindow(rangeStart, rangeEnd);
  const ownedClientIds = await ownedClientIdsFor(organizationId, ownerUserId);

  const [placements, retained] = await Promise.all([
    prisma.placement.findMany({
      where: earnedPlacementWhere(organizationId, start, endExclusive, ownerUserId),
      select: { placedAt: true, feeTotal: true },
    }),
    prisma.retainedSearch.findMany({
      where: retainedEarnedWhere(organizationId, start, endExclusive, ownedClientIds),
      select: { createdAt: true, totalAmount: true },
    }),
  ]);

  const events = [
    ...placements
      .filter((r): r is { placedAt: Date; feeTotal: typeof r.feeTotal } => r.placedAt != null)
      .map((r) => ({ placedAt: r.placedAt, amount: toNumber(r.feeTotal) })),
    // A retainer's "placed at" for charting purposes is when it was booked.
    ...retained.map((r) => ({ placedAt: r.createdAt, amount: toNumber(r.totalAmount) })),
  ];
  events.sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
  return events;
}

// The single number a REVENUE goal is paced against.
//
// EARNED for every period (Andrew's decision, 2026-09-01 · Ace 99.0).
// A deal counts when it CLOSES, not when someone gets round to invoicing
// it: `earned` is Placement.feeTotal for placements PLACED in the window,
// so it moves the day the desk actually books the work and cannot be
// shifted by invoice timing. This replaces the earlier billed-based
// headline (the 2026-05-26 Goal Pacing basis).
//
// `billed` and `collected` are NOT dropped - every surface that showed
// them still does. Only the figure that drives pace index, projection and
// status changed.
//
// TWO EXCEPTIONS, both deliberate and both unchanged by that decision:
//
//   MILESTONE reads COLLECTED. A milestone is lifetime cash actually in
//   the bank - the seeded one says so in its own notes ("Lifetime cash
//   collected. Ron takes us seriously past this line.") - and neither
//   booking a deal nor invoicing it is the same as having been paid.
//
//   AVG_DEAL_SIZE reads BILLED, and does not call this function at all
//   (see resolveAvgDealSize). "What did a deal bill for" is the question
//   that metric answers; pacing it on earned would silently change what
//   the average means.
export function revenueHeadline(r: RevenueResult, period?: GoalPeriod): number {
  if (period === GoalPeriod.MILESTONE) return r.collected;
  return r.earned;
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
    where: placementCountWhere(organizationId, start, endExclusive, ownerUserId),
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
  // AVG_DEAL_SIZE stays on BILLED, deliberately, and therefore does NOT go
  // through revenueHeadline (which now returns earned). An average deal
  // size answers "what did a deal bill for"; switching it to earned would
  // quietly change what the number means, and it is the one revenue-shaped
  // metric the earned decision does not apply to.
  return revenue.billed / placements;
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
    // RF dependency: nothing here reads RF, calls RF, or falls
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
  // The goal's period. Only REVENUE reads it, and only to apply the
  // MILESTONE-reads-collected exception in revenueHeadline. Omitting it
  // yields the billed headline, which is the right default everywhere
  // that is not a milestone.
  period?: GoalPeriod | null;
  // Required when metric is MANUAL.
  goalId?: string | null;
}): Promise<MetricResult> {
  const { organizationId, metric, rangeStart, rangeEnd, ownerUserId, goalId, period } = input;
  const args = [organizationId, rangeStart, rangeEnd, ownerUserId] as const;

  switch (metric) {
    case GoalMetric.REVENUE: {
      const revenue = await resolveRevenue(...args);
      return { value: revenueHeadline(revenue, period ?? undefined), revenue };
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
