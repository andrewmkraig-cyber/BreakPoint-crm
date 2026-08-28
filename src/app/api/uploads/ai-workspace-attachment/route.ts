import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
import { createChunkedUploadHandler } from "@/lib/chunked-upload-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  DOCX_MIME,
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

export async function DELETE(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let id = "";
  try {
    const body = (await req.json()) as { id?: unknown };
    id = typeof body.id === "string" ? body.id.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await prisma.resumeUpload.deleteMany({ where: { id, uploaderId: userId } });
  return NextResponse.json({ ok: true });
}
