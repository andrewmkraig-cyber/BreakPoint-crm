import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Redaction output is always application/pdf (pdf-lib saves PDFs).
const ALLOWED = new Set(["application/pdf"]);

// Saves a redacted variant on the existing CandidateResume row. Caller
// can identify the candidate by cuid or legacy RF id — we resolve to
// Candidate.id and target CandidateResume by candidateId. Writes to
// `redacted*` fields only; `data` (the original) stays pristine.
type RedactExtra = { candidateId: string; candidateRfId: number | null };

export const POST = createChunkedUploadHandler<RedactExtra>({
  allowedMime: ALLOWED,
  parseExtra: async (body) => {
    const b = body as { candidateId?: string; candidateRfId?: number | string };
    if (typeof b.candidateId === "string" && b.candidateId.length > 0) {
      const row = await prisma.candidate.findUnique({
        where: { id: b.candidateId },
        select: { id: true, rfId: true },
      });
      if (!row) throw new Error("candidateId not found");
      return { candidateId: row.id, candidateRfId: row.rfId };
    }
    if (b.candidateRfId != null) {
      const rfId = Number(b.candidateRfId);
      if (!Number.isFinite(rfId)) throw new Error("candidateRfId invalid");
      const row = await prisma.candidate.findFirst({
        where: { rfId },
        select: { id: true, rfId: true },
      });
      if (!row) throw new Error("candidateRfId not found");
      return { candidateId: row.id, candidateRfId: row.rfId };
    }
    throw new Error("candidateId or candidateRfId required");
  },
  createFirstRow: async ({ mimeType, size, firstChunk, isLast, extra }) => {
    const existing = await prisma.candidateResume.findUnique({
      where: { candidateId: extra.candidateId },
      select: { id: true },
    });
    if (!existing) throw new Error("Original resume row not found");

    const updated = await prisma.candidateResume.update({
      where: { id: existing.id },
      data: {
        redactedData: new Uint8Array(firstChunk),
        redactedMimeType: mimeType,
        redactedSize: size,
        redactedAt: isLast ? new Date() : null,
      },
      select: { id: true, redactedData: true },
    });
    if (isLast) {
      revalidatePath(`/candidates/${extra.candidateId}`);
      if (extra.candidateRfId != null) revalidatePath(`/candidates/${extra.candidateRfId}`);
    }
    return {
      id: updated.id,
      totalBytesStored: updated.redactedData ? updated.redactedData.byteLength : 0,
    };
  },
  appendChunk: async ({ id, chunk, isLast }) => {
    const existing = await prisma.candidateResume.findUnique({
      where: { id },
      select: { redactedData: true, candidateId: true, candidateRfId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    const prior = existing.redactedData ? Buffer.from(existing.redactedData) : Buffer.alloc(0);
    const combined = Buffer.concat([prior, chunk]);
    await prisma.candidateResume.update({
      where: { id },
      data: {
        redactedData: new Uint8Array(combined),
        redactedAt: isLast ? new Date() : null,
      },
    });
    if (isLast) {
      if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
      revalidatePath(`/candidates/${existing.candidateRfId}`);
    }
    return { totalBytesStored: combined.byteLength };
  },
});
