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

export const POST = createChunkedUploadHandler<{ clientId: string }>({
  allowedMime: ALLOWED,
  parseExtra: (body) => {
    const clientId = (body as { clientId?: number | string }).clientId;
    if (typeof clientId !== "string" || !clientId.trim()) {
      throw new Error("clientId missing or invalid");
    }
    return { clientId: clientId.trim() };
  },
  createFirstRow: async ({ userId, filename, mimeType, size, firstChunk, isLast, extra }) => {
    const org = await getCurrentOrg();
    // Scope the target client to the caller's org (Rule 8) before writing.
    const client = await prisma.client.findFirst({
      where: { id: extra.clientId, organizationId: org.id },
      select: { id: true },
    });
    if (!client) throw new Error("Client not found");
    const row = await prisma.clientBenefitsFile.create({
      data: {
        clientId: client.id,
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
    if (isLast) revalidatePath(`/clients/${client.id}`);
    return { id: row.id, totalBytesStored: row.data?.byteLength ?? 0 };
  },
  appendChunk: async ({ userId, id, chunk, isLast }) => {
    const existing = await prisma.clientBenefitsFile.findUnique({
      where: { id },
      select: { data: true, uploadedById: true, clientId: true },
    });
    if (!existing) throw new Error("Upload session not found");
    if (existing.uploadedById !== userId) throw new Error("Not your upload");

    const combined = Buffer.concat([existing.data ? Buffer.from(existing.data) : Buffer.alloc(0), chunk]);
    await prisma.clientBenefitsFile.update({
      where: { id },
      data: { data: new Uint8Array(combined), uploadComplete: isLast },
    });
    if (isLast && existing.clientId) revalidatePath(`/clients/${existing.clientId}`);
    return { totalBytesStored: combined.byteLength };
  },
});
