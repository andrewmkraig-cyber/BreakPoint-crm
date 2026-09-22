import "server-only";

import { Prisma } from "@prisma/client";

import { installmentNumberFromNote, placementBillingAnchor } from "@/lib/placement-dates";

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
//                                     "scheduled" events keyed off the
//                                     placement's billing anchor
//   3. else                         → single "scheduled" event at feeTotal
//                                     on the placement's billing anchor
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
  // Null for retained-search events: a retained engagement is billed
  // against a Client + Job before any placement exists, so its money has no
  // placement to hang off. Exactly one of placementId / retainedSearchId is
  // set on every event.
  placementId: string | null;
  retainedSearchId: string | null;
  // Always whole cents so this composes with invoices.ts which works in
  // cents throughout. Dollar callers can divide by 100 at the edge.
  amountCents: number;
  // When this dollar is expected to ARRIVE. For invoice events, dueDate
  // (falling back through sentAt to createdAt). For installment fallback,
  // placementBillingAnchor plus instNDaysAfterStart. For feeTotal
  // fallback, placementBillingAnchor. The Cash Forecast and Pipeline Value
  // read this: they answer "when will the money land".
  scheduledAt: Date;
  // The quarter this dollar BELONGS to. Andrew's rule (2026-09-22): billing
  // goes by the placement's start date, not the invoice's due date. A
  // standard invoice books on the start date itself, so a client's Net-10
  // / Net-30 terms can never push a September deal into Q4. An installment
  // books on ITS day of the schedule (start + instNDaysAfterStart), so a
  // second installment 180 days out books two quarters later, where the
  // recruiter expects to see it. The Billing Tower, its drill-downs and
  // the jump-to-period list bucket by this. Retained engagements have no
  // start, so their events book on scheduledAt.
  bookedAt: Date;
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
  // Set when this placement filled a retained search. Such a placement
  // contributes ZERO billing events: the engagement's money is already on
  // the books through the retained search's own invoice, so counting the
  // placement too would bill the same fee twice.
  retainedSearchId?: string | null;
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
    // "Installment N of M ..." on custom-terms rows; tells bookedAt which
    // day of the schedule this invoice is. Optional so older callers that
    // build the shape by hand keep compiling; they book on the start date.
    notes?: string | null;
  }>;
};

// Prisma select fragment for every column expandPlacementBillingEvents
// needs. Spread this into a placement query's `select` to ensure
// every required field is present without re-typing the column list.
export const BILLING_EVENT_PLACEMENT_SELECT = {
  id: true,
  retainedSearchId: true,
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
      notes: true,
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

// Shape shared by placement-attached and retained invoices. Both convert to
// events through invoiceToEvent below, so a retained invoice is gated on
// status and windowed on dates exactly like every other invoice.
export type InvoiceForBilling = {
  id: string;
  status: "DRAFT" | "SENT" | "PAID" | "VOID";
  feeAmount: Prisma.Decimal | null;
  dueDate: Date | null;
  sentAt: Date | null;
  paidAt: Date | null;
  isFuture: boolean;
  createdAt: Date;
};

// ONE invoice → event conversion, used by the placement path and the
// retained path alike. Returns null for VOID invoices and zero amounts.
function invoiceToEvent(
  inv: InvoiceForBilling,
  owner: {
    placementId: string | null;
    retainedSearchId: string | null;
    // The placement's start date; null for retained invoices, which then
    // book on their own scheduledAt.
    bookedAt: Date | null;
  },
): BillingEvent | null {
  const status = invoiceStatusToEventStatus(inv.status, inv.isFuture);
  if (!status) return null;
  const amountCents = decimalToCents(inv.feeAmount);
  if (amountCents === 0) return null;
  // dueDate is when the money is expected to arrive. Falls back through
  // sentAt to createdAt so we always have *something*.
  const scheduledAt = inv.dueDate ?? inv.sentAt ?? inv.createdAt;
  return {
    placementId: owner.placementId,
    retainedSearchId: owner.retainedSearchId,
    amountCents,
    scheduledAt,
    bookedAt: owner.bookedAt ?? scheduledAt,
    paidAt: inv.paidAt,
    status,
    source: "invoice",
    invoiceId: inv.id,
  };
}

// Every billing event carried by a retained search's invoices. This is the
// counterpart to expandPlacementBillingEvents for money that has no
// placement behind it, and it is what keeps a retained invoice from being
// dropped by surfaces that used to reach invoices only through Placement.
export function expandRetainedInvoiceEvents(
  invoices: Array<InvoiceForBilling & { retainedSearchId: string | null }>,
): BillingEvent[] {
  const events: BillingEvent[] = [];
  for (const inv of invoices) {
    if (!inv.retainedSearchId) continue;
    const event = invoiceToEvent(inv, {
      placementId: null,
      retainedSearchId: inv.retainedSearchId,
      bookedAt: null,
    });
    if (event) events.push(event);
  }
  return events;
}

// Prisma select fragment for a retained invoice. Mirrors the invoice select
// inside BILLING_EVENT_PLACEMENT_SELECT so both invoice families carry the
// same columns into invoiceToEvent.
export const RETAINED_INVOICE_SELECT = {
  id: true,
  retainedSearchId: true,
  status: true,
  feeAmount: true,
  dueDate: true,
  sentAt: true,
  paidAt: true,
  isFuture: true,
  createdAt: true,
} as const;

// The window every retained-invoice loader applies. Kept here so the
// Billing Tower, Goal Pacing, and the Scoreboard all reach the same set.
export function retainedInvoiceWindowWhere(
  organizationId: string,
  from: Date,
  endExclusive: Date,
) {
  return {
    organizationId,
    retainedSearchId: { not: null },
    OR: [
      { dueDate: { gte: from, lt: endExclusive } },
      { sentAt: { gte: from, lt: endExclusive } },
      { paidAt: { gte: from, lt: endExclusive } },
      { createdAt: { gte: from, lt: endExclusive } },
    ],
  };
}

// Expand a placement into its billing events. Branch selection is mutually
// exclusive so consumers never double-count: a placement contributes
// events from invoices OR installments OR feeTotal — never two of those
// at the same time.
export function expandPlacementBillingEvents(
  p: PlacementForBilling,
): BillingEvent[] {
  // Branch 0: a placement that filled a retained search contributes NOTHING.
  // The engagement was invoiced against the retained search before this
  // candidate existed, and those invoices are counted directly (see
  // expandRetainedInvoiceEvents). Returning events here as well would put
  // the same fee on the books twice. The placement still counts everywhere
  // that measures activity rather than dollars — placement count, win rate,
  // days to fill, offers — because those never route through this helper.
  if (p.retainedSearchId) return [];

  // Branch 1: any non-VOID invoice → expand them. Even a single DRAFT
  // is enough to take this branch — the recruiter has begun creating
  // invoice rows, so the installment fallback is no longer the source
  // of truth.
  // Every event a placement carries books off its start date
  // (placementBillingAnchor): a standard invoice on the start day itself,
  // an installment on its day of the schedule. Computed once here so the
  // three branches cannot drift.
  const anchor = placementBillingAnchor(p);
  const installmentDays: Record<number, number | null> = {
    1: p.inst1DaysAfterStart,
    2: p.inst2DaysAfterStart,
    3: p.inst3DaysAfterStart,
  };
  const liveInvoices = p.invoices.filter((inv) => inv.status !== "VOID");
  if (liveInvoices.length > 0) {
    const events: BillingEvent[] = [];
    for (const inv of liveInvoices) {
      const installmentNo = installmentNumberFromNote(inv.notes);
      const days = installmentNo != null ? installmentDays[installmentNo] : null;
      const event = invoiceToEvent(inv, {
        placementId: p.id,
        retainedSearchId: null,
        bookedAt: anchor && days != null ? addDays(anchor, days) : anchor,
      });
      if (event) events.push(event);
    }
    return events;
  }

  // Branch 2: custom terms set, no invoices yet → expand installments.
  // Date anchor: placementBillingAnchor — the EARLIER of the agreed start
  // and the confirmation stamp, falling back to placedAt. It used to be
  // `startConfirmedAt ?? expectedStartDate ?? placedAt`, which dated the
  // schedule to whenever the recruiter uploaded the start screenshot: a
  // September 21 start confirmed on October 10 put every installment in
  // Q4. See src/lib/placement-dates.ts for why earliest-wins.
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
        retainedSearchId: null,
        amountCents: dollarsToCents(inst.amount),
        scheduledAt: addDays(anchor, days),
        // An installment books on its own day of the schedule.
        bookedAt: addDays(anchor, days),
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
  // Same anchor as Branch 2 so a placement cannot bill in one quarter on
  // flat terms and a different one on installments.
  if (flat != null && flat > 0 && anchor) {
    return [
      {
        placementId: p.id,
        retainedSearchId: null,
        amountCents: flat * 100,
        scheduledAt: anchor,
        bookedAt: anchor,
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

// Clubhouse Billing Tower numbers, sourced from the helper so custom-
// terms placements without Invoice rows yet (Ethan) contribute the
// right amount to Revenue / Outstanding / Goal Progress.
//
// Revenue        - every event (paid + unpaid) bucketed by bookedAt in
//                  [start, end): a standard invoice on the placement's
//                  START date, an installment on its day of the schedule
//                  (Andrew, 2026-09-22). "Booked placement revenue for
//                  this period" - what the recruiter earned in the window,
//                  not just what cash hit the bank.
// Collected      - paid events with bookedAt in [start, end). The paid
//                  half of Revenue, so Revenue = Collected + Outstanding to
//                  the cent. Bucketed like Revenue (by bookedAt, not
//                  paidAt) precisely so the three tiles reconcile.
// Outstanding    — unpaid events (sent/draft/future_draft/scheduled)
//                  with bookedAt in [start, end). Period-bounded so
//                  selecting Next Quarter shows the unpaid portion of
//                  next-quarter revenue, not the all-time backlog.
// bookedCents    — alias for revenueCents kept on the return shape so
//                  callers wiring Goal Progress against booked revenue
//                  don't have to refactor. Numerically identical.
//
// We import prisma lazily so this module can stay client-importable
// (it's used by server actions only, but the type imports are safe
// either way).
type PrismaLike = typeof import("@/lib/prisma").prisma;

export type BillingSummary = {
  revenueCents: number;
  revenueCount: number;
  collectedCents: number;
  collectedCount: number;
  outstandingCents: number;
  outstandingCount: number;
  bookedCents: number;
};

// Who the money belongs to. Carried on each event so the Billing Tower
// drill-downs can name the placement behind a dollar amount without a
// second query.
export type BillingPlacementRef = {
  id: string;
  candidateRfId: number | null;
  candidate: { id: string; firstName: string; lastName: string | null } | null;
  client: { id: string; name: string } | null;
  job: { title: string } | null;
};

export type BillingEventWithPlacement = BillingEvent & {
  placement: BillingPlacementRef;
};

// BILLING_EVENT_PLACEMENT_SELECT plus the identity columns the drill-down
// rows render. The extra relations are three small joins on a handful of
// rows, so the Billing Tower totals carry them too rather than maintaining
// a second query shape that could drift from the first.
const BILLING_PLACEMENT_SELECT = {
  ...BILLING_EVENT_PLACEMENT_SELECT,
  candidateRfId: true,
  candidate: { select: { id: true, firstName: true, lastName: true } },
  client: { select: { id: true, name: true } },
  job: { select: { title: true } },
} as const;

// ONE loader behind both the Billing Tower totals and the Revenue /
// Outstanding drill-downs. Same placement set, same window predicate, so
// a popup's row list can never disagree with the number that opened it —
// if this filter changes, both surfaces change together.
//
// Pulls every placement that COULD have an event landing in [start, end) —
// a 12-month lookback, kept wide so installments anchored to a placement
// that started up to a year before the window are still picked up.
// Per-event bucketing below does the precise filtering.
async function loadBillingEventsInWindow(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  prisma: PrismaLike,
): Promise<BillingEventWithPlacement[]> {
  const aYearBeforeStart = new Date(start.getTime() - 365 * MS_PER_DAY);
  const placements = await prisma.placement.findMany({
    where: {
      organizationId,
      stage: { in: ["offer", "pending_start", "hired"] },
      OR: [
        { expectedStartDate: { gte: aYearBeforeStart, lt: endExclusive } },
        { placedAt: { gte: aYearBeforeStart, lt: endExclusive } },
        { startConfirmedAt: { gte: aYearBeforeStart, lt: endExclusive } },
      ],
    },
    select: BILLING_PLACEMENT_SELECT,
  });

  // Retained invoices are loaded directly, NOT through Placement. A retained
  // engagement is billed before any candidate exists, so a placement-rooted
  // query can never reach it — that is exactly how this money used to vanish
  // from Revenue, Outstanding, Goal Progress, and both drill-downs.
  //
  // The window is deliberately wide (same 12-month lookback as placements)
  // because per-event bucketing below does the precise filtering. Status
  // gating is identical: VOID is dropped by invoiceToEvent, everything else
  // counts on the same terms as a placement invoice.
  const retainedInvoices = await prisma.invoice.findMany({
    where: retainedInvoiceWindowWhere(
      organizationId,
      aYearBeforeStart,
      endExclusive,
    ),
    select: {
      ...RETAINED_INVOICE_SELECT,
      roleTitle: true,
      client: { select: { id: true, name: true } },
    },
  });

  const events: BillingEventWithPlacement[] = [];

  for (const inv of retainedInvoices) {
    if (!inv.retainedSearchId) continue;
    // A retained engagement has no candidate, so the drill-down row names
    // the client and the role being searched instead.
    const ref: BillingPlacementRef = {
      id: inv.retainedSearchId,
      candidateRfId: null,
      candidate: null,
      client: inv.client,
      job: inv.roleTitle ? { title: inv.roleTitle } : null,
    };
    for (const e of expandRetainedInvoiceEvents([inv])) {
      if (e.bookedAt < start || e.bookedAt >= endExclusive) continue;
      events.push({ ...e, placement: ref });
    }
  }

  for (const p of placements) {
    const ref: BillingPlacementRef = {
      id: p.id,
      candidateRfId: p.candidateRfId,
      candidate: p.candidate,
      client: p.client,
      job: p.job,
    };
    // Windowed on bookedAt (start date, or the installment's day), so the
    // tower and its drill-downs put a deal in the quarter it started
    // regardless of the client's payment terms.
    for (const e of expandPlacementBillingEvents(p as PlacementForBilling)) {
      if (e.bookedAt < start || e.bookedAt >= endExclusive) continue;
      events.push({ ...e, placement: ref });
    }
  }
  return events;
}

// Every billing event landing in [start, end), with its placement attached.
// Backs the Billing Tower Revenue / Collected / Outstanding drill-downs:
// Revenue is this whole list, Collected is the `status === "paid"` subset and
// Outstanding is the `status !== "paid"` subset - exactly the split
// getBillingSummaryForRange totals below.
export async function getBillingEventsForRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  prisma: PrismaLike,
): Promise<BillingEventWithPlacement[]> {
  return loadBillingEventsInWindow(organizationId, start, endExclusive, prisma);
}

// Generalized period-bounded totals.
export async function getBillingSummaryForRange(
  organizationId: string,
  start: Date,
  endExclusive: Date,
  prisma: PrismaLike,
): Promise<BillingSummary> {
  const events = await loadBillingEventsInWindow(
    organizationId,
    start,
    endExclusive,
    prisma,
  );

  let revenueCents = 0;
  let revenueCount = 0;
  let collectedCents = 0;
  let collectedCount = 0;
  let outstandingCents = 0;
  let outstandingCount = 0;

  for (const e of events) {
    // Revenue - booked, period-bucketed by bookedAt (placement start).
    // Counts every event regardless of payment status.
    revenueCents += e.amountCents;
    revenueCount += 1;
    // Collected and Outstanding partition Revenue: every event lands in
    // exactly one of them, so the two always sum back to Revenue.
    if (e.status === "paid") {
      collectedCents += e.amountCents;
      collectedCount += 1;
    } else {
      outstandingCents += e.amountCents;
      outstandingCount += 1;
    }
  }

  return {
    revenueCents,
    revenueCount,
    collectedCents,
    collectedCount,
    outstandingCents,
    outstandingCount,
    // bookedCents kept as an alias for revenueCents — older callers
    // (my-dashboard's Goal Progress math) reference this field name.
    bookedCents: revenueCents,
  };
}

// Backward-compat wrapper. Computes the current-quarter window in
// local time (matching the periodRange("THIS_QUARTER") shape) and
// delegates to the period-bounded variant.
export async function getCurrentQuarterBillingSummary(
  organizationId: string,
  now: Date,
  prisma: PrismaLike,
): Promise<BillingSummary> {
  const qIndex = Math.floor(now.getMonth() / 3);
  const qStart = new Date(now.getFullYear(), qIndex * 3, 1);
  const qEnd = new Date(now.getFullYear(), qIndex * 3 + 3, 1);
  return getBillingSummaryForRange(organizationId, qStart, qEnd, prisma);
}
