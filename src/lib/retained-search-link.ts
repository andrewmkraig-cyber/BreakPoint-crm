import "server-only";

import { prisma } from "@/lib/prisma";

// Links a just-made placement to the OPEN retained search on its job, if
// there is one, and marks that search FILLED.
//
// Called ONLY from the fill moments — recordPlacement and
// recordLocalPlacement (offer accepted, fee locked) and confirmStart (start
// confirmed). Deliberately NOT called from the early-stage paths that also
// create Placement rows (applied / kept / interviewing / rejected): a
// candidate merely touching a retained job must not mark the engagement
// filled, and an offer can still be declined.
//
// Never throws. A retained search that fails to link is a reporting problem;
// a placement that fails to save is a lost deal. Callers get null and carry
// on.
export async function linkPlacementToRetainedSearch(args: {
  placementId: string;
  jobId: string | null | undefined;
  organizationId: string;
}): Promise<string | null> {
  const { placementId, jobId, organizationId } = args;
  if (!jobId) return null;

  try {
    // Idempotent: a re-fired confirmStart on an already-linked placement
    // should reuse the existing link rather than hunting for another search.
    const placement = await prisma.placement.findFirst({
      where: { id: placementId, organizationId },
      select: { id: true, retainedSearchId: true },
    });
    if (!placement) return null;
    if (placement.retainedSearchId) return placement.retainedSearchId;

    const open = await prisma.retainedSearch.findMany({
      where: { organizationId, jobId, status: "OPEN" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (open.length === 0) return null;

    // More than one OPEN search on the same job is a data oddity, not a
    // reason to fail a placement. Take the oldest and say so in the log.
    if (open.length > 1) {
      // eslint-disable-next-line no-console
      console.warn("[retained-search] multiple OPEN searches on one job", {
        jobId,
        placementId,
        count: open.length,
        linkedTo: open[0]!.id,
        ignored: open.slice(1).map((s) => s.id),
      });
    }

    const target = open[0]!;

    await prisma.$transaction([
      prisma.placement.update({
        where: { id: placement.id },
        data: { retainedSearchId: target.id },
      }),
      prisma.retainedSearch.update({
        where: { id: target.id },
        data: { status: "FILLED", placementId: placement.id },
      }),
    ]);

    return target.id;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[retained-search] auto-link failed", {
      placementId,
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
