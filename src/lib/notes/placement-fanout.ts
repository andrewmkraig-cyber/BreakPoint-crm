import "server-only";

import { prisma } from "@/lib/prisma";

// Fans an offer/placement note out to the candidate, client, and job
// profiles as ONE shared Note row (the Note model is an implicit M2M to all
// three — see src/app/notes/actions.ts). Called from recordLocalOffer and
// recordLocalPlacement (local-placement-actions.ts) right after the
// placement.update.
//
// Idempotency: the note is keyed by (sourcePlacementId, createdById,
// organizationId). The first save (offer) creates it; advancing to placement
// — or re-saving either — updates the SAME row and re-points its attachments,
// so no duplicate ever lands on the three profiles. Body is the current
// stage's notes string; offer and placement share one evolving note per deal.
//
// Rule 8: organizationId + createdById are resolved by the caller from the
// server session, and candidate/client/job ids are read off an already
// org-scoped Placement row, so every attached id is guaranteed in-tenant — no
// client-supplied id reaches this path. Notes stay author-private (createdById
// scoped) exactly like every other note.
//
// cuids only — never the numeric RF stand-ins (candidateRfId/jobRfId/
// clientRfId). The M2M connect targets Note's cuid relations; a synthetic
// numeric id would not resolve.
//
// Failure-isolated: the placement save is the primary action. A note-fanout
// error is logged and swallowed so it can never roll back or block the deal
// from advancing.
export async function fanOutPlacementNote(params: {
  organizationId: string;
  createdById: string;
  placementId: string;
  title: string | null;
  body: string;
  candidateId: string | null;
  clientId: string | null;
  jobId: string | null;
}): Promise<void> {
  try {
    const body = params.body?.trim() ?? "";
    // Skip the fanout entirely when there is no note text — never write an
    // empty note onto the three profiles.
    if (!body) return;

    const title = params.title?.trim() || null;
    const candidateIds = params.candidateId ? [params.candidateId] : [];
    const clientIds = params.clientId ? [params.clientId] : [];
    const jobIds = params.jobId ? [params.jobId] : [];

    const existing = await prisma.note.findFirst({
      where: {
        sourcePlacementId: params.placementId,
        organizationId: params.organizationId,
        createdById: params.createdById,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.note.update({
        where: { id: existing.id },
        data: {
          title,
          body,
          // `set` re-points the full attachment list so a deal that changed
          // its client/job since the offer self-corrects on the next save.
          candidates: { set: candidateIds.map((id) => ({ id })) },
          clients: { set: clientIds.map((id) => ({ id })) },
          jobs: { set: jobIds.map((id) => ({ id })) },
        },
      });
      return;
    }

    await prisma.note.create({
      data: {
        organizationId: params.organizationId,
        createdById: params.createdById,
        sourcePlacementId: params.placementId,
        title,
        body,
        candidates: { connect: candidateIds.map((id) => ({ id })) },
        clients: { connect: clientIds.map((id) => ({ id })) },
        jobs: { connect: jobIds.map((id) => ({ id })) },
      },
    });
  } catch (e) {
    console.error("[notes.fanOutPlacementNote] failed", {
      placementId: params.placementId,
      error: e,
    });
  }
}
