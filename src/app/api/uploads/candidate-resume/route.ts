import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

// Persists a resume for an existing Candidate. The request body can carry
// either `candidateId` (cuid — the canonical post-Phase-1 form) or a
// legacy `candidateRfId` (numeric). We resolve to the cuid and write the
// row keyed by Candidate.id; `candidateRfId` on CandidateResume stays as
// historical reference only and is filled from the target Candidate's rfId
// so legacy URL paths (/api/candidate-resumes/<rfId>) continue to match.
// Phase 5: organizationId is NOT NULL on Candidate, so every row the
// resolver returns carries a concrete orgId — the type reflects that.
type UploadExtra = { candidateId: string; candidateRfId: number | null; organizationId: string };

async function resolveCandidate(body: unknown): Promise<UploadExtra> {
  const b = body as { candidateId?: string; candidateRfId?: number | string } | null;
  if (b && typeof b.candidateId === "string" && b.candidateId.length > 0) {
    const row = await prisma.candidate.findUnique({
      where: { id: b.candidateId },
      select: { id: true, rfId: true, organizationId: true },
    });
    if (!row) throw new Error("candidateId not found");
    return { candidateId: row.id, candidateRfId: row.rfId, organizationId: row.organizationId };
  }
  if (b && (typeof b.candidateRfId === "number" || typeof b.candidateRfId === "string")) {
    const rfId = Number(b.candidateRfId);
    if (!Number.isFinite(rfId)) throw new Error("candidateRfId invalid");
    const row = await prisma.candidate.findFirst({
      where: { rfId },
      select: { id: true, rfId: true, organizationId: true },
    });
    if (!row) throw new Error("candidateRfId not found");
    return { candidateId: row.id, candidateRfId: row.rfId, organizationId: row.organizationId };
  }
  throw new Error("candidateId or candidateRfId required");
}

export const POST = createChunkedUploadHandler<UploadExtra>({
  allowedMime: ALLOWED,
  parseExtra: resolveCandidate,
  createFirstRow: async ({ userId, filename, mimeType, size, firstChunk, isLast, extra }) => {
    // Phase 5A.5.a: every upload creates a NEW row instead of upserting
    // by candidate. The @unique constraints on candidateId / candidateRfId
    // were dropped in the same migration. Each candidate can now carry
    // multiple uploaded versions; the version dropdown on the profile
    // surfaces them. The candidateRfId fallback to negative synthetic IDs
    // for Ace-native uploads is kept (column is still required Int) but
    // is now harmless — no unique collision possible.
    const row = await prisma.candidateResume.create({
      data: {
        candidateId: extra.candidateId,
        candidateRfId: extra.candidateRfId ?? -Date.now(),
        organizationId: extra.organizationId,
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: isLast,
        uploadedById: userId,
      },
      select: { id: true, data: true },
    });
    if (isLast) {
      revalidatePath(`/candidates/${extra.candidateId}`);
      if (extra.candidateRfId != null) revalidatePath(`/candidates/${extra.candidateRfId}`);
    }
    return { id: row.id, totalBytesStored: row.data.byteLength };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.candidateResume.findUnique({
      where: { id },
      select: { data: true, uploadedById: true, candidateId: true, candidateRfId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploadedById !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([Buffer.from(existing.data), chunk]);
    await prisma.candidateResume.update({
      where: { id },
      data: { data: new Uint8Array(combined), uploadComplete: isLast },
    });
    if (isLast) {
      if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
      revalidatePath(`/candidates/${existing.candidateRfId}`);
    }
    return { totalBytesStored: combined.byteLength };
  },
});
