import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const POST = createChunkedUploadHandler<{ clientRfId: number }>({
  allowedMime: ALLOWED,
  parseExtra: (body) => {
    const id = Number((body as { clientId?: number | string }).clientId);
    if (!Number.isFinite(id)) throw new Error("clientId missing or invalid");
    return { clientRfId: id };
  },
  createFirstRow: async ({ userId, filename, mimeType, size, firstChunk, isLast, extra }) => {
    const row = await prisma.clientAgreement.create({
      data: {
        clientRfId: extra.clientRfId,
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: isLast,
        uploadedById: userId,
      },
      select: { id: true, data: true },
    });
    if (isLast) revalidatePath(`/clients/${extra.clientRfId}`);
    return { id: row.id, totalBytesStored: row.data.byteLength };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.clientAgreement.findUnique({
      where: { id },
      select: { data: true, uploadedById: true, clientRfId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploadedById !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([Buffer.from(existing.data), chunk]);
    await prisma.clientAgreement.update({
      where: { id },
      data: { data: new Uint8Array(combined), uploadComplete: isLast },
    });
    if (isLast) revalidatePath(`/clients/${existing.clientRfId}`);
    return { totalBytesStored: combined.byteLength };
  },
});
