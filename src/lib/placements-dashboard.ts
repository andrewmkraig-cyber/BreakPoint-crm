import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { placementTotalDollars } from "@/lib/billing-events";

// Data layer for the placements dashboard. Pulls every Placement in the
// pending_start / hired stages within the requested period, joined with
// candidate, client, job, and the most-recent linked Invoice, then
// derives a per-row billing status the UI can group / filter on without
// re-reading the invoice table.
//
// Stage mapping: the prompt's "HIRED" / "PENDING_START" correspond to
// the canonical Neon Placement.stage values "hired" / "pending_start"
// (the source of truth — see CLAUDE.md rule 13).

export type PlacementsDashboardPeriod =
  | "YTD"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "NEXT_QUARTER";

export type PlacementsDashboardBillingStatus =
  | "PENDING_START"
  // INVOICE_DRAFT is the single-invoice equivalent of the split-payment
  // INVOICED bucket: confirmStart has fired and an Invoice row exists
  // (Invoice.status = DRAFT) but the recruiter hasn't sent it yet.
  // Before this existed the single-invoice deriveBillingStatus fell
  // through to PENDING_START for DRAFT invoices, so the row kept reading
  // "Pending Start" on the dashboard after the candidate had officially
  // started. Display label: "Invoice Draft" (see placements-ledger).
  | "INVOICE_DRAFT"
  | "BILLED"
  | "COLLECTED"
  | "OVERDUE"
  // Split-payment-only statuses (installmentCount > 1). INVOICED replaces
  // PENDING_START once confirmStart has fired and the installment invoices
  // exist as DRAFT/SENT. PARTIALLY_PAID kicks in once at least one of
  // those invoices is PAID but at least one is still outstanding. Single-
  // invoice placements never produce either value — their flow remains
  // PENDING_START → INVOICE_DRAFT → BILLED → COLLECTED (or OVERDUE).
  | "INVOICED"
  | "PARTIALLY_PAID";

export type PlacementsDashboardPlacementType = "SALARY" | "CONTRACT";

// One channel per canonical Lead Source (src/lib/lead-sources.ts) plus OTHER
// for anything legacy or free-form. Keep these in sync with that list: a
// dropdown option with no channel here silently lands in Other, which is how
// every Indeed placement ended up mis-bucketed.
export type PlacementsDashboardSourceChannel =
  | "NETWORK"
  | "REFERRAL"
  | "LINKEDIN"
  | "INBOUND"
  | "INDEED"
  | "PIN"
  | "APOLLO"
  | "ZIPRECRUITER"
  | "ZOOMINFO"
  | "OTHER";

export type PlacementsDashboardRow = {
  id: string;
  // Canonical Neon stage literal — drives the placement edit drawer
  // which needs to know whether the row is in offer / pending_start /
  // hired to pick the right copy.
  stage: "offer" | "pending_start" | "hired";
  candidateId: string | null;
  candidateFullName: string;
  // The most recent linked invoice, if any. Drives the ledger row's
  // click target (invoice detail) and the deeper drilldowns to come.
  invoiceId: string | null;
  clientId: string | null;
  clientName: string;
  clientIndustry: string | null;
  roleTitle: string | null;
  startDate: Date | null;
  city: string | null;
  // Raw Placement.cityOverride (separate from `city` above, which
  // falls back to client.location.city when the override is empty).
  // The edit drawer seeds its City input from this so an empty drawer
  // value means "clear the override" rather than "no client city set".
  cityOverride: string | null;
  feeAmount: number | null;
  billingStatus: PlacementsDashboardBillingStatus;
  // Raw placement-side fields for the edit drawer (separate from
  // feeAmount, which prefers the invoice's amount when present).
  feeTotal: number | null;
  minFee: number | null;
  feePercentage: number | null;
  placementNotes: string | null;
  // High-level bucket the placement maps to for the By-Sourcing card.
  // Derived from Placement.source — see deriveSourceChannel().
  sourceChannel: PlacementsDashboardSourceChannel;
  // Snapshot of Placement.acceptedSalary. When acceptedCompensationType is
  // "salary" this is annual base; when "hourly" this is the hourly rate.
  baseSalary: number | null;
  acceptedCompensationType: "salary" | "hourly" | null;
  // Placement.placedAt — the moment the offer was accepted and the fee
  // locked. Drives the Offer→Start lead-time KPI alongside startDate.
  offerAcceptedAt: Date | null;
  // SALARY for direct-hire / permanent placements, CONTRACT for
  // staffing / hourly. Derived from Job.employmentType when set; falls
  // back to "did the recruiter capture an annual salary?".
  placementType: PlacementsDashboardPlacementType;
  // True when this row's client has at least one placement landing in
  // the previous calendar year (relative to now). Powers the repeat-
  // client KPI without forcing every consumer to run the same lookback
  // query independently.
  clientHadPriorYearPlacement: boolean;
  // Recruiter-tagged lead source for this placement. Surfaced as the
  // "Source" column on the placements ledger and as the source-mix
  // input on the Financial Performance card.
  leadSource: string | null;
  // Custom payment agreement fields — threaded through so the placement
  // edit drawer can display and edit previously-saved terms. Raw
  // Placement columns; customGuaranteeDate stays a Date here and is
  // serialized to ISO at the client boundary (toLedgerRows).
  useCustomTerms: boolean;
  installmentCount: number | null;
  inst1Amount: number | null;
  inst1DaysAfterStart: number | null;
  inst2Amount: number | null;
  inst2DaysAfterStart: number | null;
  inst3Amount: number | null;
  inst3DaysAfterStart: number | null;
  customGuaranteeDate: Date | null;
  // Default guarantee window in days from start. The guarantee end date
  // is `startDate + guaranteePeriodDays` UNLESS customGuaranteeDate is
  // set (which overrides the days math). Surfaced for the live
  // "days remaining" countdown on the placements + pipeline hired tabs.
  guaranteePeriodDays: number | null;
};

type ClientLocationJson = {
  city?: string | null;
  state?: string | null;
} | null;

function cityFromClientLocation(location: Prisma.JsonValue | null | undefined): string | null {
  if (!location || typeof location !== "object" || Array.isArray(location)) return null;
  const loc = location as ClientLocationJson;
  const city = loc?.city?.trim();
  return city ? city : null;
}

// Resolve a "City, ST" string off Job structured fields. Used as a
// second-stage fallback after Client.location.city — RF-imported Jobs
// frequently leave locationCity/locationState null but carry the
// composed string on locations[0] (the JD import wrote the free-form
// "Springfield, OH" array but never split it into the structured
// columns). Preference order:
//   1. locationCity (+ locationState if set)   — Ace-native write path
//   2. locations[0]                            — RF-imported fallback
// Returns null when neither shape carries a city — callers fall back
// to the Placement.cityOverride manual input.
function cityFromJob(
  job: { locationCity?: string | null; locationState?: string | null; locations?: string[] } | null | undefined,
): string | null {
  if (!job) return null;
  const structured = job.locationCity?.trim();
  if (structured) {
    const state = job.locationState?.trim();
    return state ? `${structured}, ${state}` : structured;
  }
  const arr = Array.isArray(job.locations) ? job.locations : [];
  for (const entry of arr) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function deriveSourceChannel(
  source: string | null | undefined,
): PlacementsDashboardSourceChannel {
  // Placement.source is the recorded "how the candidate landed on this
  // job" tag (see schema comment). Values currently in the wild are
  // free-form strings — we bucket conservatively. Anything we can't
  // confidently slot lands in OTHER; the user can refine later by
  // adding new recorded source values.
  const raw = (source ?? "").toLowerCase().trim();
  if (!raw) return "OTHER";
  if (raw.includes("referral")) return "REFERRAL";
  if (raw.includes("linkedin")) return "LINKEDIN";
  if (raw.includes("indeed")) return "INDEED";
  if (raw.includes("ziprecruiter")) return "ZIPRECRUITER";
  if (raw.includes("zoominfo")) return "ZOOMINFO";
  if (raw.includes("apollo")) return "APOLLO";
  // "pin" is short enough to appear inside other words, so match it whole.
  if (/\bpin\b/.test(raw)) return "PIN";
  if (raw.includes("job_board") || raw.includes("careers_form") || raw.includes("inbound")) {
    return "INBOUND";
  }
  if (raw.includes("recruiter_applied") || raw.includes("network") || raw.includes("sourced")) {
    return "NETWORK";
  }
  return "OTHER";
}

function derivePlacementType(args: {
  employmentType: string | null;
  acceptedSalary: number | null;
}): PlacementsDashboardPlacementType {
  const et = args.employmentType?.toLowerCase().trim() ?? "";
  if (et.includes("contract")) return "CONTRACT";
  if (et) return "SALARY";
  return args.acceptedSalary != null ? "SALARY" : "CONTRACT";
}

function deriveBillingStatus(args: {
  startDate: Date | null;
  installmentCount: number | null;
  // Full non-VOID invoice set for the placement. The split-payment branch
  // needs to see every installment to decide INVOICED vs PARTIALLY_PAID;
  // the single-invoice branch falls back to invoices[0] (the most-recent
  // by createdAt, matching the prior single-invoice behavior).
  invoices: ReadonlyArray<{
    status: "DRAFT" | "SENT" | "PAID" | "VOID";
    dueDate: Date | null;
  }>;
  now: Date;
}): PlacementsDashboardBillingStatus {
  const { startDate, installmentCount, invoices, now } = args;
  const live = invoices.filter((iv) => iv.status !== "VOID");
  const isSplit = (installmentCount ?? 0) > 1;

  if (isSplit && live.length > 0) {
    const paidCount = live.filter((iv) => iv.status === "PAID").length;
    const unpaid = live.filter(
      (iv) => iv.status === "DRAFT" || iv.status === "SENT",
    );

    // All paid — same terminal state as a single-invoice COLLECTED.
    if (paidCount > 0 && unpaid.length === 0) return "COLLECTED";

    // Any past-due SENT installment outranks both INVOICED and
    // PARTIALLY_PAID. Mirrors the single-invoice precedence
    // (SENT + past dueDate → OVERDUE).
    const anyOverdue = unpaid.some(
      (iv) =>
        iv.status === "SENT" &&
        iv.dueDate &&
        iv.dueDate.getTime() < now.getTime(),
    );
    if (anyOverdue) return "OVERDUE";

    // Some paid, some still DRAFT/SENT → partially paid.
    if (paidCount > 0) return "PARTIALLY_PAID";

    // All DRAFT/SENT, none paid yet — replaces the old PENDING_START
    // display once confirmStart has materialized the installment rows.
    return "INVOICED";
  }

  // Single-invoice (or pre-confirmStart split with no invoices yet):
  // preserve the original latest-invoice behavior so nothing changes for
  // the existing flow PENDING_START → INVOICE_DRAFT → BILLED → COLLECTED
  // / OVERDUE. The DRAFT branch is the 2026-05-27 addition — without it a
  // post-confirmStart row kept falling through to PENDING_START even
  // though the candidate had already started.
  const latest = live[0] ?? null;
  const invoiceStatus = latest?.status ?? null;
  const invoiceDueDate = latest?.dueDate ?? null;
  if (invoiceStatus === "PAID") return "COLLECTED";
  if (invoiceStatus === "SENT") {
    if (invoiceDueDate && invoiceDueDate.getTime() < now.getTime()) return "OVERDUE";
    return "BILLED";
  }
  if (invoiceStatus === "DRAFT") return "INVOICE_DRAFT";
  if (!invoiceStatus && startDate && startDate.getTime() > now.getTime()) {
    return "PENDING_START";
  }
  return "PENDING_START";
}

export async function getPlacementsDashboardData(
  orgId: string,
  range: { start: Date; endExclusive: Date },
): Promise<PlacementsDashboardRow[]> {
  const now = new Date();
  const { start, endExclusive: end } = range;

  // Prior-year window for the repeat-client KPI. Calendar-year-based
  // ("did this client place with us in 2025?") regardless of the
  // current period — the recruiter-facing meaning is "this is a
  // returning client," not "this client placed within the last N
  // months from the period start."
  const priorYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const priorYearEnd = new Date(now.getFullYear(), 0, 1);

  // Period window pivots on expectedStartDate — the placement's promised
  // start is the recruiter-facing date on the dashboard. Rows without an
  // expectedStartDate fall through to placedAt so a freshly-locked
  // placement awaiting its start date still surfaces inside the period.
  const [placements, priorYearGroups] = await Promise.all([
    prisma.placement.findMany({
      where: {
        organizationId: orgId,
        stage: { in: ["hired", "pending_start"] },
        OR: [
          { expectedStartDate: { gte: start, lt: end } },
          { AND: [{ expectedStartDate: null }, { placedAt: { gte: start, lt: end } }] },
        ],
      },
      select: {
        id: true,
        stage: true,
        candidateId: true,
        clientId: true,
        placedAt: true,
        expectedStartDate: true,
        offerTitle: true,
        feeTotal: true,
        minFee: true,
        feePercentage: true,
        placementNotes: true,
        acceptedSalary: true,
        acceptedCompensationType: true,
        cityOverride: true,
        source: true,
        candidateSource: true,
        useCustomTerms: true,
        installmentCount: true,
        inst1Amount: true,
        inst1DaysAfterStart: true,
        inst2Amount: true,
        inst2DaysAfterStart: true,
        inst3Amount: true,
        inst3DaysAfterStart: true,
        customGuaranteeDate: true,
        guaranteePeriodDays: true,
        // startConfirmedAt is the most authoritative date anchor for
        // custom-terms installment expansion (Branch 2 in billing-events).
        // We already select it indirectly through the placement model
        // but the explicit select keeps this query readable.
        startConfirmedAt: true,
        candidate: { select: { firstName: true, lastName: true } },
        client: { select: { name: true, industry: true, location: true } },
        job: {
          select: {
            title: true,
            employmentType: true,
            // Pulled for the city-resolution fallback chain below. RF-
            // imported jobs commonly have Client.location.city = null but
            // carry the city string on Job.locations (e.g. Jennifer Cole
            // / Sheehan Brothers — locations: ["Springfield, OH"]). We
            // prefer the structured locationCity column when set and fall
            // back to locations[0] when it isn't.
            locationCity: true,
            locationState: true,
            locations: true,
          },
        },
        // All non-VOID invoices (not just the most recent), with every
        // column the billing-events helper needs. The row layer below
        // still picks invoices[0] for `invoiceId` / billing status
        // display, but the feeAmount column now sums across all
        // invoices via placementTotalDollars so a placement with three
        // SENT installment invoices reads its full total instead of
        // only the most recent invoice's amount.
        invoices: {
          where: { status: { not: "VOID" } },
          orderBy: { createdAt: "desc" },
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
      },
      orderBy: [{ expectedStartDate: "asc" }],
    }),
    prisma.placement.findMany({
      where: {
        organizationId: orgId,
        stage: { in: ["hired", "pending_start"] },
        clientId: { not: null },
        OR: [
          { expectedStartDate: { gte: priorYearStart, lt: priorYearEnd } },
          {
            AND: [
              { expectedStartDate: null },
              { placedAt: { gte: priorYearStart, lt: priorYearEnd } },
            ],
          },
        ],
      },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
  ]);

  const priorYearClientIds = new Set(
    priorYearGroups
      .map((row) => row.clientId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  return placements.map<PlacementsDashboardRow>((p) => {
    const candidateFullName = [p.candidate?.firstName, p.candidate?.lastName]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(" ")
      .trim();
    const invoice = p.invoices[0] ?? null;
    // Resolution chain: cityOverride > Client.location.city > Job
    // structured/locations. The Job fallback catches RF-imported
    // placements where the Client row has no location JSON but the Job
    // carries the city (e.g. Jennifer Cole / Sheehan Brothers — Bug 1,
    // Batch 4a). cityOverride still wins so the recruiter's manual fix
    // is never blown away by a downstream client.location update.
    const fallbackCity =
      cityFromClientLocation(p.client?.location ?? null) ?? cityFromJob(p.job);
    const cityOverride = p.cityOverride?.trim();
    const placementType = derivePlacementType({
      employmentType: p.job?.employmentType ?? null,
      acceptedSalary: p.acceptedSalary,
    });
    return {
      id: p.id,
      stage: (p.stage === "offer" || p.stage === "pending_start" || p.stage === "hired"
        ? p.stage
        : "hired") as "offer" | "pending_start" | "hired",
      candidateId: p.candidateId ?? null,
      candidateFullName,
      invoiceId: invoice?.id ?? null,
      clientId: p.clientId ?? null,
      clientName: p.client?.name ?? "",
      clientIndustry: p.client?.industry ?? null,
      roleTitle: p.offerTitle ?? p.job?.title ?? null,
      startDate: p.expectedStartDate,
      city: cityOverride ? cityOverride : fallbackCity,
      cityOverride: cityOverride ? cityOverride : null,
      // Routed through the shared billing-events helper so:
      //   - custom-terms placements with no invoices yet (Ethan) read
      //     the sum of inst1+inst2+inst3 instead of "—"
      //   - placements with multiple installment invoices read the full
      //     sum instead of just the most recent invoice's amount
      //   - truly fee-unset placements (no invoices, no custom terms,
      //     no feeTotal) still read null → ledger renders "—"
      feeAmount: placementTotalDollars(p),
      billingStatus: deriveBillingStatus({
        startDate: p.expectedStartDate,
        installmentCount: p.installmentCount ?? null,
        invoices: p.invoices,
        now,
      }),
      feeTotal: p.feeTotal ?? null,
      minFee: p.minFee ?? null,
      feePercentage: p.feePercentage ?? null,
      placementNotes: p.placementNotes ?? null,
      sourceChannel: deriveSourceChannel(p.candidateSource ?? p.source),
      baseSalary: p.acceptedSalary ?? null,
      acceptedCompensationType: p.acceptedCompensationType === "hourly" ? "hourly" : "salary",
      offerAcceptedAt: p.placedAt,
      placementType,
      clientHadPriorYearPlacement: p.clientId
        ? priorYearClientIds.has(p.clientId)
        : false,
      leadSource: p.candidateSource ?? null,
      useCustomTerms: p.useCustomTerms,
      installmentCount: p.installmentCount ?? null,
      inst1Amount: p.inst1Amount ?? null,
      inst1DaysAfterStart: p.inst1DaysAfterStart ?? null,
      inst2Amount: p.inst2Amount ?? null,
      inst2DaysAfterStart: p.inst2DaysAfterStart ?? null,
      inst3Amount: p.inst3Amount ?? null,
      inst3DaysAfterStart: p.inst3DaysAfterStart ?? null,
      customGuaranteeDate: p.customGuaranteeDate ?? null,
      guaranteePeriodDays: p.guaranteePeriodDays ?? null,
    };
  });
}
