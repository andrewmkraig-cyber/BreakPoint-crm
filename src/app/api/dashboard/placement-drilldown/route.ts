import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  getRfClientsForOrg,
  getRfJobsForOrg,
} from "@/lib/candidates";
import { normalizeClient, normalizeJob } from "@/lib/rf-payload-shapes";
import {
  BILLING_EVENT_PLACEMENT_SELECT,
  placementTotalDollars,
  type PlacementForBilling,
} from "@/lib/billing-events";

export const dynamic = "force-dynamic";

// Backs the dashboard drill-down popups (Billing Tower's Billed
// Revenue / Cash Collected tiles, Scoreboard's Top Clients and Top
// Roles cards). Returns the flat list of placements that roll up into
// the clicked aggregate so the popup can show summary rows linked to
// the originating invoice / candidate / job pages.
//
// Query params:
//   kind=billed_revenue | cash_collected | client | role
//   id=<clientId | roleTitle>   (required for kind=client and kind=role)
//   period=quarter | annual     (defaults to quarter)
//
// Every read is org-scoped via getCurrentOrg(). The handler funnels
// each kind through a tailored Prisma read then projects rows into a
// single response shape so the dialog component stays kind-agnostic.

type DrilldownKind = "billed_revenue" | "cash_collected" | "client" | "role";
type DrilldownPeriod = "quarter" | "annual";

export type DrilldownRow = {
  placementId: string;
  candidateName: string;
  candidateHref: string | null;
  clientName: string;
  roleTitle: string;
  feeAmount: number | null;
  startDateIso: string | null;
  billingStatus:
    | "PENDING_START"
    | "INVOICE_DRAFT"
    | "INVOICED"
    | "BILLED"
    | "PARTIALLY_PAID"
    | "COLLECTED"
    | "OVERDUE";
  primaryHref: string | null;
};

export type DrilldownResponse = {
  rows: DrilldownRow[];
  totalFee: number;
  count: number;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const idParam = url.searchParams.get("id");
  const periodParam = url.searchParams.get("period");

  if (
    kindParam !== "billed_revenue" &&
    kindParam !== "cash_collected" &&
    kindParam !== "client" &&
    kindParam !== "role"
  ) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }
  const kind = kindParam as DrilldownKind;

  const period: DrilldownPeriod = periodParam === "annual" ? "annual" : "quarter";

  if ((kind === "client" || kind === "role") && !idParam) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const org = await getCurrentOrg();
  const now = new Date();
  const { start, endExclusive } = periodWindow(period, now);

  // Each kind builds its own Prisma where + select then projects into
  // DrilldownRow. We RF-name-resolve clients and jobs at the end so
  // the legacy RF rows in placements still surface a real label.
  const placements = await fetchPlacements({
    kind,
    id: idParam,
    orgId: org.id,
    start,
    endExclusive,
  });

  // Fetch RF dictionaries once so client + job names resolve for
  // legacy rows whose Placement.clientId / jobId are still null.
  const [rfClients, rfJobs] = await Promise.all([
    getRfClientsForOrg().catch(() => []),
    getRfJobsForOrg().catch(() => []),
  ]);
  const rfClientName = new Map<number, string>();
  for (const cl of rfClients) {
    rfClientName.set(cl.id, normalizeClient(cl).name);
  }
  const rfJobTitle = new Map<number, string>();
  for (const j of rfJobs) {
    rfJobTitle.set(j.id, normalizeJob(j).title);
  }

  const rows = placements.map<DrilldownRow>((p) => {
    const candidateName = p.candidate
      ? [p.candidate.firstName, p.candidate.lastName].filter(Boolean).join(" ").trim() ||
        "(unnamed)"
      : p.candidateRfId != null
        ? `RF #${p.candidateRfId}`
        : "(unknown)";
    const candidateHref = p.candidateId
      ? `/candidates/${p.candidateId}`
      : p.candidateRfId != null
        ? `/candidates/${p.candidateRfId}`
        : null;
    const clientName =
      p.client?.name ??
      (p.clientRfId != null ? rfClientName.get(p.clientRfId) ?? "" : "") ??
      "";
    const roleTitle =
      p.job?.title ??
      (p.jobRfId != null ? rfJobTitle.get(p.jobRfId) ?? "" : "") ??
      "";

    // Pick the most-recent invoice for billing-status derivation +
    // primary-href targeting. Reducer accumulator stays at the wider
    // shape returned by Prisma (the invoice select now pulls every
    // column the billing-events helper needs), but we only read id /
    // status / dueDate / paidAt below.
    type InvoiceForReduce = (typeof p.invoices)[number];
    const latestInvoice = (p.invoices ?? []).reduce<InvoiceForReduce | null>(
      (acc, inv) => {
        if (!acc) return inv;
        const a = acc.paidAt ?? acc.dueDate ?? new Date(0);
        const b = inv.paidAt ?? inv.dueDate ?? new Date(0);
        return b.getTime() > a.getTime() ? inv : acc;
      },
      null,
    );

    const startDate = p.expectedStartDate ?? p.placedAt ?? null;
    // Pass the full invoice set + installmentCount so split-payment
    // placements can resolve to INVOICED / PARTIALLY_PAID. The
    // single-invoice branch inside deriveBillingStatus still falls back
    // to invoices[0] semantics.
    const billingStatus = deriveBillingStatus({
      startDate,
      installmentCount: p.installmentCount ?? null,
      invoices: p.invoices ?? [],
      now,
    });

    const primaryHref = latestInvoice
      ? `/invoices/${latestInvoice.id}`
      : candidateHref;

    return {
      placementId: p.id,
      candidateName,
      candidateHref,
      clientName,
      roleTitle,
      // Routed through the billing-events helper so custom-terms placements
      // without Invoice rows yet (Ethan) read their installment sum
      // instead of feeTotal=null → "—". Truly fee-unset placements
      // (no invoices, no custom terms, no feeTotal) still return null.
      feeAmount: placementTotalDollars(p as PlacementForBilling),
      startDateIso: startDate ? startDate.toISOString() : null,
      billingStatus,
      primaryHref,
    };
  });

  rows.sort((a, b) => {
    const ad = a.startDateIso ? Date.parse(a.startDateIso) : 0;
    const bd = b.startDateIso ? Date.parse(b.startDateIso) : 0;
    return bd - ad;
  });

  const totalFee = rows.reduce((s, r) => s + (r.feeAmount ?? 0), 0);

  const body: DrilldownResponse = {
    rows,
    totalFee,
    count: rows.length,
  };
  return NextResponse.json(body);
}

function periodWindow(
  period: DrilldownPeriod,
  now: Date,
): { start: Date; endExclusive: Date } {
  if (period === "annual") {
    const start = new Date(now.getFullYear(), 0, 1);
    const endExclusive = new Date(now.getFullYear() + 1, 0, 1);
    return { start, endExclusive };
  }
  const quarterIndex = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), quarterIndex * 3, 1);
  const endExclusive = new Date(now.getFullYear(), quarterIndex * 3 + 3, 1);
  return { start, endExclusive };
}

type FetchArgs = {
  kind: DrilldownKind;
  id: string | null;
  orgId: string;
  start: Date;
  endExclusive: Date;
};

type PlacementRow = {
  id: string;
  candidateId: string | null;
  candidateRfId: number | null;
  clientId: string | null;
  clientRfId: number | null;
  jobId: string | null;
  jobRfId: number | null;
  feeTotal: number | null;
  stage: string;
  placedAt: Date | null;
  expectedStartDate: Date | null;
  // Billing-event helper fields. Required by placementTotalDollars
  // so custom-terms placements without Invoice rows yet render their
  // installment sum in the drilldown's fee column.
  startConfirmedAt: Date | null;
  useCustomTerms: boolean;
  // Drives the split-payment branch in deriveBillingStatus (INVOICED /
  // PARTIALLY_PAID only fire when installmentCount > 1).
  installmentCount: number | null;
  inst1Amount: number | null;
  inst1DaysAfterStart: number | null;
  inst2Amount: number | null;
  inst2DaysAfterStart: number | null;
  inst3Amount: number | null;
  inst3DaysAfterStart: number | null;
  candidate: { firstName: string; lastName: string | null } | null;
  client: { id: string; name: string } | null;
  job: { id: string; title: string } | null;
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

const PLACEMENT_SELECT = {
  // Spread the billing-event select first so its invoice sub-select
  // (with every column placementTotalDollars needs) wins over the
  // narrower invoice select the drilldown used to declare. Display-only
  // fields layer on top.
  ...BILLING_EVENT_PLACEMENT_SELECT,
  candidateId: true,
  candidateRfId: true,
  clientId: true,
  clientRfId: true,
  jobId: true,
  jobRfId: true,
  stage: true,
  placedAt: true,
  // Read alongside the invoice list so the split-payment branch of
  // deriveBillingStatus below can decide INVOICED vs PARTIALLY_PAID.
  installmentCount: true,
  candidate: { select: { firstName: true, lastName: true } },
  client: { select: { id: true, name: true } },
  job: { select: { id: true, title: true } },
} as const;

async function fetchPlacements(args: FetchArgs): Promise<PlacementRow[]> {
  const { kind, id, orgId, start, endExclusive } = args;
  if (kind === "billed_revenue") {
    // Mirror the Scoreboard Billed tile: placements (pending_start +
    // hired) that have at least one SENT or PAID invoice whose dueDate
    // lands inside the window. Switched from filtering by
    // Placement.expectedStartDate so split-payment placements correctly
    // surface in the quarter their installment is due — a Jun-10 start
    // with a $3,750 inst-2 due in Q3 now shows up under the Q3 Billed
    // drill-down, where previously it only ever appeared under Q2.
    return prisma.placement.findMany({
      where: {
        organizationId: orgId,
        stage: { in: ["pending_start", "hired"] },
        invoices: {
          some: {
            organizationId: orgId,
            status: { in: ["SENT", "PAID"] },
            dueDate: { gte: start, lt: endExclusive },
          },
        },
      },
      select: PLACEMENT_SELECT,
    });
  }
  if (kind === "cash_collected") {
    // Invoices paid in window → their parent placements. One invoice
    // points to one placement via Invoice.placementId, so we walk
    // back to the placement set in two steps to keep the join shape
    // identical to the other kinds.
    const paidInvoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: "PAID",
        paidAt: { gte: start, lt: endExclusive },
      },
      select: { placementId: true },
    });
    const placementIds = Array.from(
      new Set(paidInvoices.map((iv) => iv.placementId).filter((x): x is string => Boolean(x))),
    );
    if (placementIds.length === 0) return [];
    return prisma.placement.findMany({
      where: { organizationId: orgId, id: { in: placementIds } },
      select: PLACEMENT_SELECT,
    });
  }
  if (kind === "client") {
    // Closed deals for a client over the window. Mirrors Scoreboard's
    // Top Clients aggregation, which keys on placedAt.
    return prisma.placement.findMany({
      where: {
        organizationId: orgId,
        clientId: id ?? "",
        placedAt: { gte: start, lt: endExclusive },
      },
      select: PLACEMENT_SELECT,
    });
  }
  // kind === "role"
  // Top Roles aggregates by Job.title (Ace) and the normalized RF job
  // title for RF rows. The popup keys on the title string itself so we
  // match across both surfaces with a case-insensitive equality.
  const target = (id ?? "").trim().toLowerCase();
  if (!target) return [];
  const placements = await prisma.placement.findMany({
    where: {
      organizationId: orgId,
      placedAt: { gte: start, lt: endExclusive },
    },
    select: PLACEMENT_SELECT,
  });
  const rfJobs = await getRfJobsForOrg().catch(() => []);
  const rfTitle = new Map<number, string>();
  for (const j of rfJobs) rfTitle.set(j.id, normalizeJob(j).title);
  return placements.filter((p) => {
    const aceTitle = p.job?.title?.trim().toLowerCase() ?? "";
    const rfTitleVal =
      p.jobRfId != null ? (rfTitle.get(p.jobRfId) ?? "").toLowerCase() : "";
    return aceTitle === target || rfTitleVal === target;
  });
}

// Mirrors src/lib/placements-dashboard.ts deriveBillingStatus. Kept inline
// here because the drilldown route ships its own DrilldownRow shape and
// doesn't import from the server-only dashboard module. Any change to one
// MUST land in the other in the same commit (see Regression Check).
function deriveBillingStatus(args: {
  startDate: Date | null;
  installmentCount: number | null;
  invoices: ReadonlyArray<{
    status: "DRAFT" | "SENT" | "PAID" | "VOID";
    dueDate: Date | null;
  }>;
  now: Date;
}): DrilldownRow["billingStatus"] {
  const { startDate, installmentCount, invoices, now } = args;
  const live = invoices.filter((iv) => iv.status !== "VOID");
  const isSplit = (installmentCount ?? 0) > 1;

  if (isSplit && live.length > 0) {
    const paidCount = live.filter((iv) => iv.status === "PAID").length;
    const unpaid = live.filter(
      (iv) => iv.status === "DRAFT" || iv.status === "SENT",
    );
    if (paidCount > 0 && unpaid.length === 0) return "COLLECTED";
    const anyOverdue = unpaid.some(
      (iv) =>
        iv.status === "SENT" &&
        iv.dueDate &&
        iv.dueDate.getTime() < now.getTime(),
    );
    if (anyOverdue) return "OVERDUE";
    if (paidCount > 0) return "PARTIALLY_PAID";
    return "INVOICED";
  }

  const latest = live[0] ?? null;
  const invoiceStatus = latest?.status ?? null;
  const invoiceDueDate = latest?.dueDate ?? null;
  if (invoiceStatus === "PAID") return "COLLECTED";
  if (invoiceStatus === "SENT") {
    if (invoiceDueDate && invoiceDueDate.getTime() < now.getTime()) return "OVERDUE";
    return "BILLED";
  }
  // INVOICE_DRAFT (2026-05-27) — confirmStart has fired and a draft
  // invoice exists, but the recruiter hasn't sent it yet. Mirror of the
  // same branch in src/lib/placements-dashboard.ts so both surfaces
  // agree on what a post-confirmStart-pre-send single-invoice row looks
  // like (previously fell through to PENDING_START on this path too).
  if (invoiceStatus === "DRAFT") return "INVOICE_DRAFT";
  if (!invoiceStatus && startDate && startDate.getTime() > now.getTime()) {
    return "PENDING_START";
  }
  return "PENDING_START";
}
