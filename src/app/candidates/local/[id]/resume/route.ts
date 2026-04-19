import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const c = await prisma.candidate.findUnique({
    where: { id: params.id },
    select: {
      resumeFilename: true,
      resumeMimeType: true,
      resumeData: true,
    },
  });

  if (!c || !c.resumeData || !c.resumeMimeType) {
    return new NextResponse("Not found", { status: 404 });
  }

  const bytes = new Uint8Array(c.resumeData.byteLength);
  bytes.set(c.resumeData);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": c.resumeMimeType,
      "Content-Disposition": `inline; filename="${c.resumeFilename ?? "resume"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
