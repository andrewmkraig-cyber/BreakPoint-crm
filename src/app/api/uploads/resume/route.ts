import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const POST = createChunkedUploadHandler<Record<string, never>>({
  allowedMime: ALLOWED,
  parseExtra: () => ({}),
  createFirstRow: async ({ userId, filename, mimeType, size, firstChunk, isLast }) => {
    const row = await prisma.resumeUpload.create({
      data: {
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: isLast,
        uploaderId: userId,
      },
      select: { id: true, data: true },
    });
    return { id: row.id, totalBytesStored: row.data.byteLength };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.resumeUpload.findUnique({
      where: { id },
      select: { data: true, uploaderId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploaderId !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([Buffer.from(existing.data), chunk]);
    await prisma.resumeUpload.update({
      where: { id },
      data: { data: new Uint8Array(combined), uploadComplete: isLast },
    });
    return { totalBytesStored: combined.byteLength };
  },
});
