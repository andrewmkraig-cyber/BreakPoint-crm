import "server-only";

import { prisma } from "@/lib/prisma";
import {
  deriveBillingStatus,
  type PlacementsDashboardBillingStatus,
} from "@/lib/placements-dashboard";
import { resolveGuaranteeEnd } from "@/components/placements/guarantee-period-utils";

// Data layer for the Retained Searches card on the Placements tab.
//
// Deliberately independent of getPlacementsDashboardData: that query roots
// at Placement, and a retained search may have no placement at all (it is
// still OPEN, or it closed unfilled). Rooting here at RetainedSearch is what
// makes those rows visible.
//
// RetainedSearch uses scalar FKs with no Prisma relations, so the client,
// job, invoice, and placement lookups are separate batched queries keyed by
// the ids on the search rows.

export type RetainedSearchCardRow = {
  id: string;
  clientName: string;
  jobTitle: string;
  totalAmount: number;
  status: "OPEN" | "FILLED" | "CLOSED_UNFILLED";
  // Installment 1's invoice for a staged engagement, the single invoice
  // otherwise. Null only when generation failed. Drives the row click.
  invoiceId: string | null;
  // Null when there is no invoice to describe. Otherwise the SAME billing
  // status vocabulary the placements ledger renders, derived by the same
  // helper — see deriveBillingStatus in placements-dashboard.
  billingStatus: PlacementsDashboardBillingStatus | null;
  // Resolved guarantee end for a FILLED search whose placement has a start
  // date. Null while OPEN (no clock yet) or CLOSED_UNFILLED. The card
  // counts down from this live.
  guaranteeEndIso: string | null;
  closeReason: string | null;
  createdAtIso: string;
};

export async function getRetainedSearchesForOrg(
  organizationId: string,
): Promise<RetainedSearchCardRow[]> {
  const searches = await prisma.retainedSearch.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      clientId: true,
      jobId: true,
      totalAmount: true,
      status: true,
      guaranteeDays: true,
      placementId: true,
      closeReason: true,
      createdAt: true,
    },
  });
  if (searches.length === 0) return [];

  const clientIds = Array.from(new Set(searches.map((s) => s.clientId)));
  const jobIds = Array.from(new Set(searches.map((s) => s.jobId)));
  const placementIds = searches
    .map((s) => s.placementId)
    .filter((x): x is string => Boolean(x));

  const [clients, jobs, invoices, placements] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: clientIds }, organizationId },
      select: { id: true, name: true },
    }),
    prisma.job.findMany({
      where: { id: { in: jobIds }, organizationId },
      select: { id: true, title: true },
    }),
    // The billable invoice per search: isFuture=false picks the single
    // full-amount invoice on a one-payment engagement and installment 1 on a
    // staged one, since installments 2+ are pre-staged as isFuture drafts.
    prisma.invoice.findMany({
      where: {
        organizationId,
        retainedSearchId: { in: searches.map((s) => s.id) },
        status: { not: "VOID" },
        isFuture: false,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        retainedSearchId: true,
        status: true,
        dueDate: true,
      },
    }),
    placementIds.length > 0
      ? prisma.placement.findMany({
          where: { id: { in: placementIds }, organizationId },
          select: { id: true, expectedStartDate: true, startConfirmedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const jobTitle = new Map(jobs.map((j) => [j.id, j.title]));
  const placementById = new Map(placements.map((p) => [p.id, p]));
  const invoiceBySearch = new Map<string, (typeof invoices)[number]>();
  for (const inv of invoices) {
    if (!inv.retainedSearchId) continue;
    // Oldest wins — installment 1 is created before any later stage.
    if (!invoiceBySearch.has(inv.retainedSearchId)) {
      invoiceBySearch.set(inv.retainedSearchId, inv);
    }
  }

  const now = new Date();

  return searches.map<RetainedSearchCardRow>((s) => {
    const invoice = invoiceBySearch.get(s.id) ?? null;

    // Same derivation the ledger uses. installmentCount stays null so the
    // helper takes its single-invoice branch, which is what "the status of
    // installment 1's invoice" means for a staged engagement.
    const billingStatus = invoice
      ? deriveBillingStatus({
          startDate: null,
          installmentCount: null,
          invoices: [{ status: invoice.status, dueDate: invoice.dueDate }],
          now,
        })
      : null;

    // The guarantee clock starts on the candidate's start date, so it only
    // exists once the search is FILLED and its placement has one.
    let guaranteeEndIso: string | null = null;
    if (s.status === "FILLED" && s.placementId) {
      const placement = placementById.get(s.placementId);
      const start = placement?.expectedStartDate ?? placement?.startConfirmedAt ?? null;
      if (start) {
        guaranteeEndIso = resolveGuaranteeEnd({
          startDateIso: start.toISOString(),
          guaranteePeriodDays: s.guaranteeDays,
          customGuaranteeDateIso: null,
        });
      }
    }

    return {
      id: s.id,
      clientName: clientName.get(s.clientId) ?? "",
      jobTitle: jobTitle.get(s.jobId) ?? "",
      totalAmount: s.totalAmount,
      status: s.status,
      invoiceId: invoice?.id ?? null,
      billingStatus,
      guaranteeEndIso,
      closeReason: s.closeReason ?? null,
      createdAtIso: s.createdAt.toISOString(),
    };
  });
}
