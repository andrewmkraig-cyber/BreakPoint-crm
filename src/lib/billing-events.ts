import "server-only";

import { Prisma } from "@prisma/client";

// Single source of truth for "how much will this placement bill, when?"
//
// Background — every dashboard finance tile used to query Invoice rows
// directly. For placements with custom installment terms but no Invoice
// rows yet (pending_start placements that haven't been Confirmed Start
// yet — Ethan's case 2026-05-26), the invoice-only aggregates returned
// zero, surfacing as "fee unset" / "—" / $0 even though the recruiter
// HAD set the fee via the installment schedule. This helper expands a
// placement into the billing events that should hit the books, picking
// the right source based on what's actually been written:
//
//   1. Non-VOID Invoice rows exist  → expand those invoices (current
//                                     recruiter flow once Confirm Start
//                                     has fired)
//   2. else if useCustomTerms       → expand inst1/inst2/inst3 as
//                                     "scheduled" events keyed off
//                                     startConfirmedAt ?? expectedStartDate
//                                     ?? placedAt
//   3. else                         → single "scheduled" event at feeTotal
//                                     on expectedStartDate ?? placedAt
//
// The three branches are mutually exclusive PER PLACEMENT (we either
// have invoices or we don't), so consumers never see the same dollars
// twice — no dedup required at the aggregator layer.
//
// Status taxonomy (drives which tiles a given event lands in):
//   paid          — Invoice.status PAID. Counts in Revenue / Collected.
//   sent          — Invoice.status SENT. Counts in Outstanding, Billed.
//   draft         — Invoice.status DRAFT, isFuture=false. Counts in
//                   Outstanding, Cash Forecast Pending.
//   future_draft  — Invoice.status DRAFT, isFuture=true. Counts in
//                   Outstanding (the schedule is committed) but NOT in
//                   Cash Forecast Pending (not sendable yet).
//   scheduled     — Branch 2 or 3 fallback. No Invoice row exists.
//                   Counts in Outstanding, Pipeline Value, Goal Pacing.
//                   Never counts in Cash Forecast Pending (not invoiced)
//                   or Billed (no invoice was sent).

export type BillingEventStatus =
  | "paid"
  | "sent"
  | "draft"
  | "future_draft"
  | "scheduled";

export type BillingEventSource = "invoice" | "installment" | "fee_total";

export type BillingEvent = {
  placementId: string;
  // Always whole cents so this composes with invoices.ts which works in
  // cents throughout. Dollar callers can divide by 100 at the edge.
  amountCents: number;
  // When this dollar lands on the books. For invoice events, prefers
  // dueDate so Q-bucketing matches how recruiters think about billing.
  // For installment fallback, computed from startConfirmedAt ?? expectedStartDate ?? placedAt
  // plus instNDaysAfterStart. For feeTotal fallback, expectedStartDate ?? placedAt.
  scheduledAt: Date;
  // Realized payment timestamp when status === "paid"; null otherwise.
  // Used by Revenue / Collected tiles that bucket by collection date,
  // not by the original schedule.
  paidAt: Date | null;
  status: BillingEventStatus;
  source: BillingEventSource;
  // Originating Invoice.id when source === "invoice"; null for fallbacks.
  invoiceId: string | null;
};

// Minimal placement projection the helper needs. Matches the columns the
// dashboard / scoreboard queries already select. Kept as a plain shape so
// callers can spread their existing Prisma `select` into it without an
// extra round trip — Prisma's inferred types are structurally compatible.
export type PlacementForBilling = {
  id: string;
  feeTotal: number | null;
  expectedStartDate: Date | null;
  placedAt: Date | null;
  startConfirmedAt: Date | null;
  useCustomTerms: boolean;
  inst1Amount: number | null;
  inst1DaysAfterStart: number | null;
  inst2Amount: number | null;
  inst2DaysAfterStart: number | null;
  inst3Amount: number | null;
  inst3DaysAfterStart: number | null;
  invoices: Array<{
    id: string;
    status: "DRAFT" | "SENT" | "PAID" | "VOID";
    feeAmount: Prisma.Decimal | null;
    dueDate: Date | null;
    sentAt: Date | null;
    paidAt: Date | null;
    isFuture: boolean;
    createdAt: Date;
  }>;
};

// Prisma select fragment for every column expandPlacementBillingEvents
// needs. Spread this into a placement query's `select` to ensure
// every required field is present without re-typing the column list.
export const BILLING_EVENT_PLACEMENT_SELECT = {
  id: true,
  feeTotal: true,
  expectedStartDate: true,
  placedAt: true,
  startConfirmedAt: true,
  useCustomTerms: true,
  inst1Amount: true,
  inst1DaysAfterStart: true,
  inst2Amount: true,
  inst2DaysAfterStart: true,
  inst3Amount: true,
  inst3DaysAfterStart: true,
  invoices: {
    select: {
      id: true,
      status: true,
      feeAmount: true,
      dueDate: true,
      sentAt: true,
      paidAt: true,
      isFuture: true,
      createdAt: true,
    },
  },
} as const;

const MS_PER_DAY = 86_400_000;

function decimalToCents(amount: Prisma.Decimal | null | undefined): number {
  if (amount == null) return 0;
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function dollarsToCents(amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

function invoiceStatusToEventStatus(
  status: "DRAFT" | "SENT" | "PAID" | "VOID",
  isFuture: boolean,
): BillingEventStatus | null {
  if (status === "PAID") return "paid";
  if (status === "SENT") return "sent";
  if (status === "DRAFT") return isFuture ? "future_draft" : "draft";
  // VOID — caller skips
  return null;
}

// Expand a placement into its billing events. Branch selection is mutually
// exclusive so consumers never double-count: a placement contributes
// events from invoices OR installments OR feeTotal — never two of those
// at the same time.
export function expandPlacementBillingEvents(
  p: PlacementForBilling,
): BillingEvent[] {
  // Branch 1: any non-VOID invoice → expand them. Even a single DRAFT
  // is enough to take this branch — the recruiter has begun creating
  // invoice rows, so the installment fallback is no longer the source
  // of truth.
  const liveInvoices = p.invoices.filter((inv) => inv.status !== "VOID");
  if (liveInvoices.length > 0) {
    const events: BillingEvent[] = [];
    for (const inv of liveInvoices) {
      const status = invoiceStatusToEventStatus(inv.status, inv.isFuture);
      if (!status) continue;
      const amountCents = decimalToCents(inv.feeAmount);
      if (amountCents === 0) continue;
      // dueDate is preferred for quarter bucketing — that's the date the
      // recruiter thinks of as "when this is on the books for Q-whatever".
      // Falls back through sentAt → createdAt so we always have *something*.
      const scheduledAt =
        inv.dueDate ?? inv.sentAt ?? inv.createdAt;
      events.push({
        placementId: p.id,
        amountCents,
        scheduledAt,
        paidAt: inv.paidAt,
        status,
        source: "invoice",
        invoiceId: inv.id,
      });
    }
    return events;
  }

  // Branch 2: custom terms set, no invoices yet → expand installments.
  // Date anchor: startConfirmedAt is the most authoritative ("we know
  // they started on this day"), expectedStartDate is the recruiter's
  // commit, placedAt is the offer-accept date. We accept any of them
  // so a pending_start placement (no startConfirmedAt yet) still casts
  // its installments into the right quarter.
  const anchor = p.startConfirmedAt ?? p.expectedStartDate ?? p.placedAt;
  if (p.useCustomTerms && anchor) {
    const events: BillingEvent[] = [];
    const installments: Array<{ amount: number | null; days: number | null }> = [
      { amount: p.inst1Amount, days: p.inst1DaysAfterStart },
      { amount: p.inst2Amount, days: p.inst2DaysAfterStart },
      { amount: p.inst3Amount, days: p.inst3DaysAfterStart },
    ];
    for (const inst of installments) {
      if (inst.amount == null || inst.amount <= 0) continue;
      const days = inst.days ?? 0;
      events.push({
        placementId: p.id,
        amountCents: dollarsToCents(inst.amount),
        scheduledAt: addDays(anchor, days),
        paidAt: null,
        status: "scheduled",
        source: "installment",
        invoiceId: null,
      });
    }
    return events;
  }

  // Branch 3: no invoices, no custom terms → single event at feeTotal
  // on the placement's start/place date. Skips entirely if feeTotal is
  // null or zero (the recruiter genuinely hasn't logged a fee yet —
  // this IS the "fee unset" state, and surfaces will render "—").
  const flat = p.feeTotal;
  const flatAnchor = p.expectedStartDate ?? p.placedAt;
  if (flat != null && flat > 0 && flatAnchor) {
    return [
      {
        placementId: p.id,
        amountCents: flat * 100,
        scheduledAt: flatAnchor,
        paidAt: null,
        status: "scheduled",
        source: "fee_total",
        invoiceId: null,
      },
    ];
  }

  return [];
}

// Sum-of-all-events convenience. Returns null when the placement
// produces no events at all (truly unset) so callers can distinguish
// "$0 fee" from "fee unset" — the existing "—" cell behavior is
// preserved by checking for null at the call site.
export function placementTotalCents(p: PlacementForBilling): number | null {
  const events = expandPlacementBillingEvents(p);
  if (events.length === 0) return null;
  return events.reduce((s, e) => s + e.amountCents, 0);
}

export function placementTotalDollars(p: PlacementForBilling): number | null {
  const cents = placementTotalCents(p);
  return cents == null ? null : Math.round(cents / 100);
}

// Window-bucketing helper used by every dashboard tile that asks
// "how much in Q-whatever?". scheduledAt is the bucket-by date for
// every status except "paid", which buckets by paidAt — the recruiter
// reads Revenue as "cash that landed this quarter" regardless of
// what the original schedule said.
export function eventInWindow(
  e: BillingEvent,
  start: Date,
  endExclusive: Date,
): boolean {
  const ref = e.status === "paid" && e.paidAt ? e.paidAt : e.scheduledAt;
  return ref >= start && ref < endExclusive;
}

// Aggregator over a placement set + status filter + window. Each
// dashboard tile composes these three knobs differently — pulling
// this into one function means a tile-level bug fix is one change,
// not seven.
export function sumEventsCents(
  placements: PlacementForBilling[],
  predicate: (e: BillingEvent) => boolean,
): number {
  let total = 0;
  for (const p of placements) {
    for (const e of expandPlacementBillingEvents(p)) {
      if (predicate(e)) total += e.amountCents;
    }
  }
  return total;
}

// Clubhouse Billing Tower's three numbers, sourced from the helper so
// custom-terms placements without Invoice rows yet (Ethan) contribute
// the right amount to Outstanding and Goal Progress.
//
// Revenue        — paid events bucketed by paidAt in the quarter.
//                  Unchanged for Ethan (he isn't paid). Same semantics
//                  as getInvoiceSummary.collectedThisQuarterCents but
//                  routed through the helper for consistency.
// Outstanding    — unpaid events (sent/draft/future_draft/scheduled)
//                  with scheduledAt < qEnd. Adds Ethan's inst1=$3,750
//                  even though no Invoice row exists.
// Booked         — every event (paid + unpaid) bucketed by scheduledAt
//                  in [qStart, qEnd). Drives Goal Progress so the
//                  tile reflects "what I earned this quarter," not
//                  just "what I collected."
//
// We import prisma lazily so this module can stay client-importable
// (it's used by server actions only, but the type imports are safe
// either way).
type PrismaLike = typeof import("@/lib/prisma").prisma;

export async function getCurrentQuarterBillingSummary(
  organizationId: string,
  now: Date,
  prisma: PrismaLike,
): Promise<{
  revenueCents: number;
  revenueCount: number;
  outstandingCents: number;
  outstandingCount: number;
  bookedCents: number;
}> {
  // Quarter window in local time, matching periodRange("THIS_QUARTER", now)
  // shape — we re-derive here so the helper stays self-contained instead
  // of importing periodRange (which would cross a "server-only" boundary
  // and circle back through @/lib).
  const qIndex = Math.floor(now.getMonth() / 3);
  const qStart = new Date(now.getFullYear(), qIndex * 3, 1);
  const qEnd = new Date(now.getFullYear(), qIndex * 3 + 3, 1);

  // Pull every placement whose events COULD land in this quarter. The
  // OR-window here is wide on purpose — a custom-terms placement
  // started a month ago might have inst2 falling this quarter, so we
  // can't filter on expectedStartDate alone. Open-stage placement
  // counts in this CRM are dozens, not millions, so pulling a 12-month
  // lookback set is cheap and the per-event bucketing below does the
  // precise filtering.
  const aYearAgo = new Date(qStart.getTime() - 365 * MS_PER_DAY);
  const placements = await prisma.placement.findMany({
    where: {
      organizationId,
      stage: { in: ["offer", "pending_start", "hired"] },
      OR: [
        { expectedStartDate: { gte: aYearAgo, lt: qEnd } },
        { placedAt: { gte: aYearAgo, lt: qEnd } },
        { startConfirmedAt: { gte: aYearAgo, lt: qEnd } },
      ],
    },
    select: BILLING_EVENT_PLACEMENT_SELECT,
  });

  let revenueCents = 0;
  let revenueCount = 0;
  let outstandingCents = 0;
  let outstandingCount = 0;
  let bookedCents = 0;

  for (const p of placements) {
    for (const e of expandPlacementBillingEvents(p as PlacementForBilling)) {
      // Booked — every event whose schedule lands this quarter, regardless
      // of payment status. Drives Goal Progress.
      if (e.scheduledAt >= qStart && e.scheduledAt < qEnd) {
        bookedCents += e.amountCents;
      }
      // Revenue — paid events bucketed by paidAt (collection date).
      if (e.status === "paid" && e.paidAt && e.paidAt >= qStart && e.paidAt < qEnd) {
        revenueCents += e.amountCents;
        revenueCount += 1;
      }
      // Outstanding — unpaid $ that comes due by end of quarter.
      // Includes scheduled installments (no invoice yet) so Ethan's
      // inst1 contributes. Excludes paid (already collected) and
      // anything scheduled past quarter end (next quarter's problem).
      if (e.status !== "paid" && e.scheduledAt < qEnd) {
        outstandingCents += e.amountCents;
        outstandingCount += 1;
      }
    }
  }

  return {
    revenueCents,
    revenueCount,
    outstandingCents,
    outstandingCount,
    bookedCents,
  };
}
