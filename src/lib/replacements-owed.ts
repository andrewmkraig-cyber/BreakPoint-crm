import "server-only";

import { prisma } from "@/lib/prisma";

// Placements that fell off where the client paid and is owed a free
// replacement. All-time, not range-bound: an owed replacement is a debt
// until a "replacement" deal is booked against it (Placement.replacesPlacementId
// pointing back here), whatever quarter either side landed in.

export type ReplacementOwedRow = {
  placementId: string;
  candidateId: string | null;
  candidateName: string;
  clientId: string | null;
  clientName: string;
  roleTitle: string | null;
  fellOffAtIso: string;
  fellOffReason: string | null;
  fellOffNotes: string | null;
  refundAmount: number | null;
  feeTotal: number | null;
  // The replacement deal already booked against this one, if any.
  replacedBy: { placementId: string; candidateId: string | null; candidateName: string; stage: string } | null;
};

function fullName(c: { firstName: string; lastName: string | null } | null): string {
  if (!c) return "Unknown candidate";
  const last = c.lastName?.trim();
  return last ? `${c.firstName} ${last}` : c.firstName;
}

export async function getReplacementsOwed(orgId: string): Promise<ReplacementOwedRow[]> {
  const rows = await prisma.placement.findMany({
    where: {
      organizationId: orgId,
      fellOffAt: { not: null },
      replacementOwed: true,
      stage: { in: ["pending_start", "hired"] },
    },
    select: {
      id: true,
      fellOffAt: true,
      fellOffReason: true,
      fellOffNotes: true,
      refundAmount: true,
      feeTotal: true,
      candidateId: true,
      clientId: true,
      candidate: { select: { firstName: true, lastName: true } },
      client: { select: { name: true } },
      job: { select: { title: true } },
      offerTitle: true,
    },
    orderBy: { fellOffAt: "desc" },
  });
  if (rows.length === 0) return [];

  const replacements = await prisma.placement.findMany({
    where: {
      organizationId: orgId,
      replacesPlacementId: { in: rows.map((r) => r.id) },
      stage: { notIn: ["cancelled", "rejected"] },
    },
    select: {
      id: true,
      stage: true,
      replacesPlacementId: true,
      candidateId: true,
      candidate: { select: { firstName: true, lastName: true } },
    },
  });
  const byOriginal = new Map<string, (typeof replacements)[number]>();
  for (const r of replacements) {
    if (r.replacesPlacementId && !byOriginal.has(r.replacesPlacementId)) {
      byOriginal.set(r.replacesPlacementId, r);
    }
  }

  return rows.map((r) => {
    const rep = byOriginal.get(r.id) ?? null;
    return {
      placementId: r.id,
      candidateId: r.candidateId,
      candidateName: fullName(r.candidate),
      clientId: r.clientId,
      clientName: r.client?.name ?? "Unknown client",
      roleTitle: r.job?.title ?? r.offerTitle ?? null,
      fellOffAtIso: (r.fellOffAt as Date).toISOString(),
      fellOffReason: r.fellOffReason,
      fellOffNotes: r.fellOffNotes,
      refundAmount: r.refundAmount,
      feeTotal: r.feeTotal,
      replacedBy: rep
        ? {
            placementId: rep.id,
            candidateId: rep.candidateId,
            candidateName: fullName(rep.candidate),
            stage: rep.stage,
          }
        : null,
    };
  });
}
