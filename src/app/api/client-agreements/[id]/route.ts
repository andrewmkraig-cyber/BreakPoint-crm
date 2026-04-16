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

  const agreement = await prisma.clientAgreement.findUnique({
    where: { id: params.id },
  });
  if (!agreement) {
    return new NextResponse("Not found", { status: 404 });
  }

  const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(agreement.data), {
    status: 200,
    headers: {
      "Content-Type": agreement.mimeType,
      "Content-Length": String(agreement.size),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(agreement.filename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
