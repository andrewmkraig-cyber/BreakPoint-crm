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

export type PlacementsDashboardPeriod = "YTD" | "THIS_QUARTER" | "LAST_90_DAYS";

export type PlacementsDashboardBillingStatus =
  | "PENDING_START"
  | "BILLED"
  | "COLLECTED"
  | "OVERDUE";

export type PlacementsDashboardRow = {
  id: string;
  candidateFullName: string;
  clientName: string;
  clientIndustry: string | null;
  roleTitle: string | null;
  startDate: Date | null;
  city: string | null;
  feeAmount: number | null;
  billingStatus: PlacementsDashboardBillingStatus;
};

type ClientLocationJson = {
  city?: string | null;
  state?: string | null;
} | null;

function periodRange(period: PlacementsDashboardPeriod, now: Date): { start: Date; end: Date } {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === "YTD") {
    return { start: new Date(now.getFullYear(), 0, 1), end };
  }
  if (period === "THIS_QUARTER") {
    const startMonth = Math.floor(now.getMonth() / 3) * 3;
    return { start: new Date(now.getFullYear(), startMonth, 1), end };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 90);
  return { start, end };
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

  // Period window pivots on expectedStartDate — the placement's promised
  // start is the recruiter-facing date on the dashboard. Rows without an
  // expectedStartDate fall through to placedAt so a freshly-locked
  // placement awaiting its start date still surfaces inside the period.
  const placements = await prisma.placement.findMany({
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
      expectedStartDate: true,
      offerTitle: true,
      feeTotal: true,
      cityOverride: true,
      candidate: { select: { firstName: true, lastName: true } },
      client: { select: { name: true, industry: true, location: true } },
      job: { select: { title: true } },
      invoices: {
        where: { status: { not: "VOID" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, feeAmount: true, dueDate: true },
      },
    },
    orderBy: [{ expectedStartDate: "asc" }],
  });

  return placements.map<PlacementsDashboardRow>((p) => {
    const candidateFullName = [p.candidate?.firstName, p.candidate?.lastName]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(" ")
      .trim();
    const invoice = p.invoices[0] ?? null;
    const fallbackCity = cityFromClientLocation(p.client?.location ?? null);
    const cityOverride = p.cityOverride?.trim();
    return {
      id: p.id,
      candidateFullName,
      clientName: p.client?.name ?? "",
      clientIndustry: p.client?.industry ?? null,
      roleTitle: p.offerTitle ?? p.job?.title ?? null,
      startDate: p.expectedStartDate,
      city: cityOverride ? cityOverride : fallbackCity,
      feeAmount: toDollars(invoice?.feeAmount ?? null) ?? (p.feeTotal != null ? p.feeTotal : null),
      billingStatus: deriveBillingStatus({
        startDate: p.expectedStartDate,
        invoiceStatus: invoice?.status ?? null,
        invoiceDueDate: invoice?.dueDate ?? null,
        now,
      }),
    };
  });
}
