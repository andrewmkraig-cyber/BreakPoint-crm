"use server";

// Who can a replacement deal be replacing? Every hired placement in the
// org, with the client's own fell-off rows first (those are the debts),
// then the client's other hires, then everyone else for the name search.
// Read-only; the pick is saved by the placement save paths.

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export type ReplacementOption = {
  placementId: string;
  candidateName: string;
  clientName: string;
  roleTitle: string | null;
  startDateIso: string | null;
  fellOffAtIso: string | null;
  replacementOwed: boolean;
  // True when this row belongs to the same client as the deal being booked.
  sameClient: boolean;
  // Name of the candidate already booked as this row's replacement, if any.
  replacedBy: string | null;
};

function fullName(c: { firstName: string; lastName: string | null } | null): string {
  if (!c) return "Unknown candidate";
  const last = c.lastName?.trim();
  return last ? `${c.firstName} ${last}` : c.firstName;
}

export async function listReplacementOptions(input: {
  // The deal being booked. Used to find the client and to exclude itself.
  placementId: string | null;
}): Promise<{ ok: true; options: ReplacementOption[] } | { ok: false; error: string }> {
  try {
    const org = await getCurrentOrg();
    // Placement.clientId is the canonical client link (backfilled for every
    // row in Phase 0), so same-client matching keys off it alone.
    let clientId: string | null = null;
    if (input.placementId) {
      const self = await prisma.placement.findFirst({
        where: { id: input.placementId, organizationId: org.id },
        select: { clientId: true },
      });
      clientId = self?.clientId ?? null;
    }

    const rows = await prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: "hired",
        ...(input.placementId ? { id: { not: input.placementId } } : {}),
      },
      select: {
        id: true,
        clientId: true,
        expectedStartDate: true,
        fellOffAt: true,
        replacementOwed: true,
        offerTitle: true,
        candidate: { select: { firstName: true, lastName: true } },
        client: { select: { name: true } },
        job: { select: { title: true } },
      },
    });

    const replacements = await prisma.placement.findMany({
      where: {
        organizationId: org.id,
        replacesPlacementId: { in: rows.map((r) => r.id) },
        stage: { notIn: ["cancelled", "rejected"] },
        ...(input.placementId ? { id: { not: input.placementId } } : {}),
      },
      select: {
        replacesPlacementId: true,
        candidate: { select: { firstName: true, lastName: true } },
      },
    });
    const replacedBy = new Map<string, string>();
    for (const r of replacements) {
      if (r.replacesPlacementId && !replacedBy.has(r.replacesPlacementId)) {
        replacedBy.set(r.replacesPlacementId, fullName(r.candidate));
      }
    }

    const options: ReplacementOption[] = rows.map((r) => ({
      placementId: r.id,
      candidateName: fullName(r.candidate),
      clientName: r.client?.name ?? "Unknown client",
      roleTitle: r.job?.title ?? r.offerTitle ?? null,
      startDateIso: r.expectedStartDate?.toISOString() ?? null,
      fellOffAtIso: r.fellOffAt?.toISOString() ?? null,
      replacementOwed: r.replacementOwed,
      sameClient: clientId != null && r.clientId === clientId,
      replacedBy: replacedBy.get(r.id) ?? null,
    }));

    // Debts first, then the rest of the client, then everyone else; newest
    // fall-off / start first within each group.
    const rank = (o: ReplacementOption) =>
      (o.sameClient ? 0 : 4) +
      (o.fellOffAtIso ? (o.replacementOwed && !o.replacedBy ? 0 : 1) : 2);
    options.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      const ta = a.fellOffAtIso ?? a.startDateIso ?? "";
      const tb = b.fellOffAtIso ?? b.startDateIso ?? "";
      return tb.localeCompare(ta);
    });
    return { ok: true, options };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load placements." };
  }
}
