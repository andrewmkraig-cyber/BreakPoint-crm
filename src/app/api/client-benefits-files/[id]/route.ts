import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const file = await prisma.clientBenefitsFile.findUnique({
    where: { id: params.id },
  });
  if (!file) return new NextResponse("Not found", { status: 404 });

  const download = req.nextUrl.searchParams.get("download") === "1";

  if (file.blobUrl) {
    // Private blob — fetch the signed downloadUrl and stream it through so the
    // browser never sees the raw blob token.
    const { head } = await import("@vercel/blob");
    const meta = (await head(file.blobUrl)) as { downloadUrl?: string; url?: string };
    const source = meta.downloadUrl ?? meta.url ?? file.blobUrl;
    const upstream = await fetch(source, { cache: "no-store" });
    if (!upstream.ok) return new NextResponse("Blob fetch failed", { status: 502 });
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file.filename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (file.data) {
    return new NextResponse(new Uint8Array(file.data), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file.filename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new NextResponse("File has no backing data.", { status: 410 });
}
