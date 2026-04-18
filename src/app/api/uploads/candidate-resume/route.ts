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

// Persists a resume on an existing RF candidate record. One row per
// candidateRfId (unique); chunk 0 upserts the row and wipes any prior bytes
// so re-upload fully replaces the old resume instead of appending.
export const POST = createChunkedUploadHandler<{ candidateRfId: number }>({
  allowedMime: ALLOWED,
  parseExtra: (body) => {
    const id = Number((body as { candidateRfId?: number | string }).candidateRfId);
    if (!Number.isFinite(id)) throw new Error("candidateRfId missing or invalid");
    return { candidateRfId: id };
  },
  createFirstRow: async ({ userId, filename, mimeType, size, firstChunk, isLast, extra }) => {
    const row = await prisma.candidateResume.upsert({
      where: { candidateRfId: extra.candidateRfId },
      create: {
        candidateRfId: extra.candidateRfId,
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: isLast,
        uploadedById: userId,
      },
      update: {
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: isLast,
        uploadedById: userId,
        uploadedAt: new Date(),
      },
      select: { id: true, data: true },
    });
    if (isLast) revalidatePath(`/candidates/${extra.candidateRfId}`);
    return { id: row.id, totalBytesStored: row.data.byteLength };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.candidateResume.findUnique({
      where: { id },
      select: { data: true, uploadedById: true, candidateRfId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploadedById !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([Buffer.from(existing.data), chunk]);
    await prisma.candidateResume.update({
      where: { id },
      data: { data: new Uint8Array(combined), uploadComplete: isLast },
    });
    if (isLast) revalidatePath(`/candidates/${existing.candidateRfId}`);
    return { totalBytesStored: combined.byteLength };
  },
});
