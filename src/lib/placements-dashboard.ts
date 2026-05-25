import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

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
  | "BILLED"
  | "COLLECTED"
  | "OVERDUE";

export type PlacementsDashboardPlacementType = "SALARY" | "CONTRACT";

export type PlacementsDashboardSourceChannel =
  | "NETWORK"
  | "REFERRAL"
  | "LINKEDIN"
  | "INBOUND"
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
  feePercentage: number | null;
  placementNotes: string | null;
  // High-level bucket the placement maps to for the By-Sourcing card.
  // Derived from Placement.source — see deriveSourceChannel().
  sourceChannel: PlacementsDashboardSourceChannel;
  // Snapshot of Placement.acceptedSalary (annual base) for direct-hire
  // placements. null when not captured (typical for contract roles).
  baseSalary: number | null;
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
};

type ClientLocationJson = {
  city?: string | null;
  state?: string | null;
} | null;

function periodRange(period: PlacementsDashboardPeriod, now: Date): { start: Date; end: Date } {
  const year = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3);
  if (period === "YTD") {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year + 1, 0, 1),
    };
  }
  if (period === "LAST_QUARTER") {
    const startMonth = currentQuarter * 3 - 3;
    const startYear = startMonth < 0 ? year - 1 : year;
    const m = ((startMonth % 12) + 12) % 12;
    return {
      start: new Date(startYear, m, 1),
      end: new Date(startYear, m + 3, 1),
    };
  }
  if (period === "NEXT_QUARTER") {
    const startMonth = currentQuarter * 3 + 3;
    const startYear = startMonth >= 12 ? year + 1 : year;
    const m = startMonth % 12;
    return {
      start: new Date(startYear, m, 1),
      end: new Date(startYear, m + 3, 1),
    };
  }
  const startMonth = currentQuarter * 3;
  return {
    start: new Date(year, startMonth, 1),
    end: new Date(year, startMonth + 3, 1),
  };
}

function toDollars(amount: Prisma.Decimal | null | undefined): number | null {
  if (amount == null) return null;
  const n = Number(amount.toString());
  return Number.isFinite(n) ? n : null;
}

function cityFromClientLocation(location: Prisma.JsonValue | null | undefined): string | null {
  if (!location || typeof location !== "object" || Array.isArray(location)) return null;
  const loc = location as ClientLocationJson;
  const city = loc?.city?.trim();
  return city ? city : null;
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
  invoiceStatus: "DRAFT" | "SENT" | "PAID" | "VOID" | null;
  invoiceDueDate: Date | null;
  now: Date;
}): PlacementsDashboardBillingStatus {
  const { startDate, invoiceStatus, invoiceDueDate, now } = args;
  if (invoiceStatus === "PAID") return "COLLECTED";
  if (invoiceStatus === "SENT") {
    if (invoiceDueDate && invoiceDueDate.getTime() < now.getTime()) return "OVERDUE";
    return "BILLED";
  }
  if (!invoiceStatus && startDate && startDate.getTime() > now.getTime()) {
    return "PENDING_START";
  }
  return "PENDING_START";
}

export async function getPlacementsDashboardData(
  orgId: string,
  period: PlacementsDashboardPeriod,
): Promise<PlacementsDashboardRow[]> {
  const now = new Date();
  const { start, end } = periodRange(period, now);

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
        feePercentage: true,
        placementNotes: true,
        acceptedSalary: true,
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
        candidate: { select: { firstName: true, lastName: true } },
        client: { select: { name: true, industry: true, location: true } },
        job: { select: { title: true, employmentType: true } },
        invoices: {
          where: { status: { not: "VOID" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, feeAmount: true, dueDate: true },
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
    const fallbackCity = cityFromClientLocation(p.client?.location ?? null);
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
      feeAmount: toDollars(invoice?.feeAmount ?? null) ?? (p.feeTotal != null ? p.feeTotal : null),
      billingStatus: deriveBillingStatus({
        startDate: p.expectedStartDate,
        invoiceStatus: invoice?.status ?? null,
        invoiceDueDate: invoice?.dueDate ?? null,
        now,
      }),
      feeTotal: p.feeTotal ?? null,
      feePercentage: p.feePercentage ?? null,
      placementNotes: p.placementNotes ?? null,
      sourceChannel: deriveSourceChannel(p.candidateSource ?? p.source),
      baseSalary: p.acceptedSalary ?? null,
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
    };
  });
}
