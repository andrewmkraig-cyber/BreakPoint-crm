import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Session-gated resume download / inline preview. The [candidateRfId] path
// param is the RF id — one resume per candidate. `?download=1` forces
// Content-Disposition: attachment for "Save As"; default is inline so the
// browser can render the PDF in an iframe on the profile.
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateRfId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  const candidateRfId = Number(params.candidateRfId);
  if (!Number.isFinite(candidateRfId)) return new NextResponse("Bad id", { status: 400 });

  const resume = await prisma.candidateResume.findUnique({
    where: { candidateRfId },
  });
  if (!resume || !resume.uploadComplete) return new NextResponse("Not found", { status: 404 });

  const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(resume.data), {
    status: 200,
    headers: {
      "Content-Type": resume.mimeType,
      "Content-Length": String(resume.size),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(resume.filename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
