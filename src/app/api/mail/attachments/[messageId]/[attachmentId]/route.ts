import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getGmailAttachment } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Stream a Gmail attachment back to the browser as a forced download.
// The MailThreadDetail payload already includes { attachmentId,
// filename, mimeType, size } per message; the client passes filename
// and mimeType as query params so this route doesn't need a second
// messages.get round-trip just to recover them. Same per-user token
// scoping as every other /api/mail route — the access token is
// derived from the signed-in user's own Account row.
export async function GET(
  req: Request,
  { params }: { params: { messageId: string; attachmentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  const url = new URL(req.url);
  const filenameRaw = url.searchParams.get("filename") || "attachment";
  const mimeType =
    url.searchParams.get("mimeType") || "application/octet-stream";

  try {
    const bytes = await getGmailAttachment(
      user.id,
      params.messageId,
      params.attachmentId,
    );
    if (!bytes) {
      return NextResponse.json(
        { error: "Attachment not available" },
        { status: 404 },
      );
    }
    // RFC 5987-encoded filename* so non-ASCII names (resumés, cyrillic,
    // emoji) survive the Content-Disposition header. Strip CR/LF to
    // block header-injection via a crafted filename query param, and
    // also send a plain ASCII fallback for older clients.
    const safeFilename = filenameRaw.replace(/[\r\n"]/g, "_");
    const asciiFallback = safeFilename.replace(/[^\x20-\x7E]/g, "_");
    const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`;
    // Copy into a fresh ArrayBuffer — Node's Buffer is typed as
    // ArrayBufferLike (possibly SharedArrayBuffer) in current
    // @types/node, which BodyInit rejects. Allocating a new
    // ArrayBuffer and copying via Uint8Array.set sidesteps the type
    // mismatch and the buffer goes straight into the Response.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(ab.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch attachment";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
