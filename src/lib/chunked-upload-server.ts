// Shared server-side machinery for chunked uploads. Each target route
// (/api/uploads/benefits-file, agreement, resume) supplies two callbacks:
// `create` to insert the first-chunk row and return its id, `append` to
// read the existing bytes, concatenate the new chunk, and write back.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB ceiling
const MAX_CHUNK_BASE64 = Math.ceil((MAX_FILE_BYTES + 1024 * 1024) * 1.4);

export type ChunkPayload = {
  id?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  chunkIndex: number;
  totalChunks: number;
  isLast: boolean;
  data: string;
  [extra: string]: unknown;
};

export type ChunkedUploadHandlers<CreateExtra> = {
  allowedMime: Set<string>;
  parseExtra: (body: ChunkPayload) => CreateExtra | Promise<CreateExtra>;
  createFirstRow: (args: {
    userId: string;
    filename: string;
    mimeType: string;
    size: number;
    firstChunk: Buffer;
    isLast: boolean;
    extra: CreateExtra;
  }) => Promise<{ id: string; totalBytesStored: number }>;
  appendChunk: (args: {
    userId: string;
    id: string;
    chunk: Buffer;
    isLast: boolean;
  }) => Promise<{ totalBytesStored: number }>;
};

async function requireUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  return user?.id ?? null;
}

export function createChunkedUploadHandler<E>(handlers: ChunkedUploadHandlers<E>) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const userId = await requireUserId();
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    let body: ChunkPayload;
    try {
      body = (await request.json()) as ChunkPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (typeof body.chunkIndex !== "number" || typeof body.totalChunks !== "number" || typeof body.data !== "string") {
      return NextResponse.json({ error: "Missing chunkIndex / totalChunks / data" }, { status: 400 });
    }
    if (body.data.length > MAX_CHUNK_BASE64) {
      return NextResponse.json({ error: "Chunk too large" }, { status: 413 });
    }

    let chunk: Buffer;
    try {
      chunk = Buffer.from(body.data, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid base64" }, { status: 400 });
    }

    const isFirst = body.chunkIndex === 0;
    const isLast = Boolean(body.isLast) || body.chunkIndex === body.totalChunks - 1;

    if (isFirst) {
      if (!body.filename || !body.mimeType || typeof body.size !== "number") {
        return NextResponse.json({ error: "First chunk requires filename/mimeType/size" }, { status: 400 });
      }
      if (body.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `File exceeds ${MAX_FILE_BYTES / (1024 * 1024)}MB limit` }, { status: 413 });
      }
      if (!handlers.allowedMime.has(body.mimeType)) {
        return NextResponse.json({ error: `Mime type not allowed: ${body.mimeType}` }, { status: 400 });
      }
      const extra = await handlers.parseExtra(body);
      const created = await handlers.createFirstRow({
        userId,
        filename: body.filename,
        mimeType: body.mimeType,
        size: body.size,
        firstChunk: chunk,
        isLast,
        extra,
      });
      return NextResponse.json(created);
    }

    if (!body.id) return NextResponse.json({ error: "Subsequent chunks require id" }, { status: 400 });
    const appended = await handlers.appendChunk({ userId, id: body.id, chunk, isLast });
    return NextResponse.json({ id: body.id, ...appended });
  };
}
