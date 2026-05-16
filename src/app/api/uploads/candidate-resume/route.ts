import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";

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
    // Single-chunk uploads (small files) finish in this call. Multi-chunk
    // uploads buffer firstChunk into Postgres `data`; appendChunk assembles
    // the rest and performs the Blob upload on the final chunk. Bytes only
    // live in `data` during the assembly window — the final state for new
    // rows is `blobUrl` set, `data` cleared to an empty buffer (backfill
    // prompt nulls these out).
    if (isLast) {
      const blob = await put(`resumes/${extra.candidateId}/${filename}`, firstChunk, {
        access: "private",
        contentType: mimeType,
        addRandomSuffix: true,
      });
      const row = await prisma.candidateResume.create({
        data: {
          candidateId: extra.candidateId,
          candidateRfId: extra.candidateRfId,
          organizationId: extra.organizationId,
          filename,
          mimeType,
          size,
          data: Buffer.alloc(0),
          blobUrl: blob.url,
          uploadComplete: true,
          uploadedById: userId,
        },
        select: { id: true },
      });
      revalidatePath(`/candidates/${extra.candidateId}`);
      if (extra.candidateRfId != null) revalidatePath(`/candidates/${extra.candidateRfId}`);
      return { id: row.id, totalBytesStored: firstChunk.byteLength };
    }
    const row = await prisma.candidateResume.create({
      data: {
        candidateId: extra.candidateId,
        candidateRfId: extra.candidateRfId,
        organizationId: extra.organizationId,
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: false,
        uploadedById: userId,
      },
      select: { id: true, data: true },
    });
    return { id: row.id, totalBytesStored: row.data?.byteLength ?? 0 };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.candidateResume.findUnique({
      where: { id },
      select: {
        data: true,
        uploadedById: true,
        candidateId: true,
        candidateRfId: true,
        filename: true,
        mimeType: true,
      },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploadedById !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([Buffer.from(existing.data ?? Buffer.alloc(0)), chunk]);
    if (isLast) {
      const blob = await put(
        `resumes/${existing.candidateId}/${existing.filename}`,
        combined,
        { access: "private", contentType: existing.mimeType, addRandomSuffix: true },
      );
      await prisma.candidateResume.update({
        where: { id },
        data: { data: Buffer.alloc(0), blobUrl: blob.url, uploadComplete: true },
      });
      if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
      if (existing.candidateRfId != null) revalidatePath(`/candidates/${existing.candidateRfId}`);
    } else {
      await prisma.candidateResume.update({
        where: { id },
        data: { data: new Uint8Array(combined), uploadComplete: false },
      });
    }
    return { totalBytesStored: combined.byteLength };
  },
});
