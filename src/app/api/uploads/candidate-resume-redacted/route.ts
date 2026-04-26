import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Redaction output is always application/pdf (pdf-lib saves PDFs).
const ALLOWED = new Set(["application/pdf"]);

// Phase 5A.5.b (Ace 20.0 / Bug B): each redaction now persists as its
// OWN CandidateResume row with variant="redacted" and the redacted
// bytes stored in `data` — mirroring the brander's pattern. The earlier
// "update redactedData on the existing row" model collided with the
// branded variant on the same candidate (Brand-then-Redact would hit
// the most-recent row, which was the branded one, and the redacted
// output disappeared from the dropdown).
type RedactExtra = {
  candidateId: string;
  candidateRfId: number | null;
  organizationId: string;
};

async function resolveCandidate(body: unknown): Promise<RedactExtra> {
  const b = body as { candidateId?: string; candidateRfId?: number | string } | null;
  if (b && typeof b.candidateId === "string" && b.candidateId.length > 0) {
    const row = await prisma.candidate.findUnique({
      where: { id: b.candidateId },
      select: { id: true, rfId: true, organizationId: true },
    });
    if (!row) throw new Error("candidateId not found");
    return {
      candidateId: row.id,
      candidateRfId: row.rfId,
      organizationId: row.organizationId,
    };
  }
  if (b && b.candidateRfId != null) {
    const rfId = Number(b.candidateRfId);
    if (!Number.isFinite(rfId)) throw new Error("candidateRfId invalid");
    const row = await prisma.candidate.findFirst({
      where: { rfId },
      select: { id: true, rfId: true, organizationId: true },
    });
    if (!row) throw new Error("candidateRfId not found");
    return {
      candidateId: row.id,
      candidateRfId: row.rfId,
      organizationId: row.organizationId,
    };
  }
  throw new Error("candidateId or candidateRfId required");
}

export const POST = createChunkedUploadHandler<RedactExtra>({
  allowedMime: ALLOWED,
  parseExtra: resolveCandidate,
  createFirstRow: async ({ userId, filename, mimeType, size, firstChunk, isLast, extra }) => {
    const row = await prisma.candidateResume.create({
      data: {
        candidateId: extra.candidateId,
        candidateRfId: extra.candidateRfId,
        organizationId: extra.organizationId,
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        variant: "redacted",
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
      if (existing.candidateRfId != null) revalidatePath(`/candidates/${existing.candidateRfId}`);
    }
    return { totalBytesStored: combined.byteLength };
  },
});
