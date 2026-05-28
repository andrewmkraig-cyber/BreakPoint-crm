import "server-only";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";

// Bust every server-rendered surface a placement edit can move so the
// recruiter sees their change immediately on the next navigation. Mirrors
// revalidateInvoiceSurfaces in src/app/invoices/actions.ts so the
// pattern stays consistent across the two main mutation paths.
//
// Surfaces refreshed:
//   /dashboard            — Scoreboard KPIs, Momentum / Recent Deal Moves,
//                           Top Clients / Roles, the Placements tab map +
//                           ledger, and the Offer-to-Start histogram.
//   /placements           — top-level placements ledger.
//   /pipeline             — every stage tab + Hired/Pending Start counts.
//   /finances             — cash forecast (Pending / Billed / Collected)
//                           and the future-invoices feed.
//   /candidates/[id]      — the candidate's pipeline pill + job rows on
//                           their profile (revalidates the specific cuid
//                           when known so we don't blow the whole route).
//                           Also revalidates by candidateRfId when set so
//                           the RF-imported variant of the candidate URL
//                           refreshes alongside the cuid variant.
//   /clients/[id]         — per-client placements list + ledger surface
//                           (specific cuid when known, route template as
//                           fallback so anonymous-row placements still
//                           refresh everywhere).
//
// Org-scoped on the lookup so a stray placementId from another tenant
// can't probe candidate / client ids out of this org. Errors swallowed —
// the underlying mutation already committed; worst case is a slightly
// stale pill that resolves on the next navigation.
export async function revalidatePlacementSurfaces(
  placementId: string,
  orgId: string,
): Promise<void> {
  revalidatePath("/dashboard");
  revalidatePath("/placements");
  revalidatePath("/pipeline");
  revalidatePath("/finances");
  try {
    const placement = await prisma.placement.findFirst({
      where: { id: placementId, organizationId: orgId },
      select: {
        candidateId: true,
        candidateRfId: true,
        clientId: true,
        clientRfId: true,
      },
    });
    if (placement?.candidateId) {
      revalidatePath(`/candidates/${placement.candidateId}`);
    }
    if (placement?.candidateRfId != null) {
      revalidatePath(`/candidates/${placement.candidateRfId}`);
    }
    if (!placement?.candidateId && placement?.candidateRfId == null) {
      revalidatePath("/candidates/[id]", "page");
    }
    if (placement?.clientId) {
      revalidatePath(`/clients/${placement.clientId}`);
    }
    if (placement?.clientRfId != null) {
      revalidatePath(`/clients/${placement.clientRfId}`);
    }
    if (!placement?.clientId && placement?.clientRfId == null) {
      revalidatePath("/clients/[id]", "page");
    }
  } catch {
    // Lookup failed — fall back to template-scoped revalidations so
    // every candidate + client page still refreshes.
    revalidatePath("/candidates/[id]", "page");
    revalidatePath("/clients/[id]", "page");
  }
}
