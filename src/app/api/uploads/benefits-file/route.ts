import { prisma } from "@/lib/prisma";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
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
    const org = await getCurrentOrg();
    const row = await prisma.clientBenefitsFile.create({
      data: {
        clientRfId: extra.clientRfId,
        filename,
        mimeType,
        size,
        data: new Uint8Array(firstChunk),
        uploadComplete: isLast,
        uploadedById: userId,
        organizationId: org.id,
      },
      select: { id: true, data: true },
    });
    if (isLast) revalidatePath(`/clients/${extra.clientRfId}`);
    return { id: row.id, totalBytesStored: row.data?.byteLength ?? 0 };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.clientBenefitsFile.findUnique({
      where: { id },
      select: { data: true, uploadedById: true, clientRfId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploadedById !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([existing.data ? Buffer.from(existing.data) : Buffer.alloc(0), chunk]);
    await prisma.clientBenefitsFile.update({
      where: { id },
      data: { data: new Uint8Array(combined), uploadComplete: isLast },
    });
    if (isLast) revalidatePath(`/clients/${existing.clientRfId}`);
    return { totalBytesStored: combined.byteLength };
  },
});
