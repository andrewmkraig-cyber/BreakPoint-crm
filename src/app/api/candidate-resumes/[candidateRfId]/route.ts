import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Session-gated resume download / inline preview. The path segment used to
// be the RF id — post-Phase-1 cutover it can be either the legacy RF id
// (numeric) or a Candidate cuid. We resolve to Candidate.id internally and
// query CandidateResume by candidateId so we never filter on candidateRfId.
// `?download=1` forces Content-Disposition: attachment; default is inline
// for the iframe preview on the profile.
export async function GET(
  req: NextRequest,
  { params }: { params: { candidateRfId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  const raw = params.candidateRfId;
  const candidate = /^\d+$/.test(raw)
    ? await prisma.candidate.findFirst({ where: { rfId: Number(raw) }, select: { id: true } })
    : await prisma.candidate.findFirst({ where: { id: raw }, select: { id: true } });
  if (!candidate) return new NextResponse("Not found", { status: 404 });

  const resume = await prisma.candidateResume.findUnique({
    where: { candidateId: candidate.id },
  });
  if (!resume || !resume.uploadComplete) return new NextResponse("Not found", { status: 404 });

  const wantsRedacted = req.nextUrl.searchParams.get("variant") === "redacted";
  const hasRedacted = Boolean(resume.redactedData && resume.redactedAt);

  const useRedacted = wantsRedacted && hasRedacted;
  const bytes = useRedacted ? resume.redactedData! : resume.data;
  const mime = useRedacted ? (resume.redactedMimeType ?? "application/pdf") : resume.mimeType;
  const baseFilename = useRedacted
    ? resume.filename.replace(/\.pdf$/i, "") + "-redacted.pdf"
    : resume.filename;
  const size = useRedacted ? (resume.redactedSize ?? bytes.byteLength) : resume.size;

  const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(baseFilename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
