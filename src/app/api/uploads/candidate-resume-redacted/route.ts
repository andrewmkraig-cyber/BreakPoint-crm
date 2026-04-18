import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Redaction output is always application/pdf (pdf-lib saves PDFs).
const ALLOWED = new Set(["application/pdf"]);

// Saves a redacted variant alongside the existing CandidateResume row. Must
// hit a row that already exists — the redactor loads the original first, so
// by the time we're uploading the redacted copy the original is on file.
// Writes to `redactedData`/`redactedMimeType`/`redactedSize`/`redactedAt`;
// never touches `data` so the original stays pristine.
export const POST = createChunkedUploadHandler<{ candidateRfId: number }>({
  allowedMime: ALLOWED,
  parseExtra: (body) => {
    const id = Number((body as { candidateRfId?: number | string }).candidateRfId);
    if (!Number.isFinite(id)) throw new Error("candidateRfId missing or invalid");
    return { candidateRfId: id };
  },
  createFirstRow: async ({ mimeType, size, firstChunk, isLast, extra }) => {
    // Use the existing row id so append steps target the same record.
    const existing = await prisma.candidateResume.findUnique({
      where: { candidateRfId: extra.candidateRfId },
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
    if (isLast) revalidatePath(`/candidates/${extra.candidateRfId}`);
    return {
      id: updated.id,
      totalBytesStored: updated.redactedData ? updated.redactedData.byteLength : 0,
    };
  },
  appendChunk: async ({ id, chunk, isLast }) => {
    const existing = await prisma.candidateResume.findUnique({
      where: { id },
      select: { redactedData: true, candidateRfId: true },
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
    if (isLast) revalidatePath(`/candidates/${existing.candidateRfId}`);
    return { totalBytesStored: combined.byteLength };
  },
});
