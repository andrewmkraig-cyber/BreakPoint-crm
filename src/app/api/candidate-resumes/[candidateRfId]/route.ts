import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";

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

  // Phase 5A.5.a: switched to findFirst orderBy uploadedAt desc so the
  // legacy URL `/api/candidate-resumes/[idOrRfId]` resolves to the most
  // recent uploaded version. Specific older versions are fetched via
  // /api/candidate-resumes/by-id/[resumeId]. Same redacted-variant
  // semantics; same download disposition. Display filename prefers
  // displayName when set so the Content-Disposition matches what the
  // recruiter renamed it to.
  const resume = await prisma.candidateResume.findFirst({
    where: { candidateId: candidate.id, uploadComplete: true },
    orderBy: { uploadedAt: "desc" },
  });
  if (!resume) return new NextResponse("Not found", { status: 404 });

  const wantsRedacted = req.nextUrl.searchParams.get("variant") === "redacted";
  // Post-Blob backfill: redactedData is null on migrated rows; bytes
  // moved to redactedBlobUrl. Either column counts as "has redacted".
  const hasRedacted = Boolean(
    (resume.redactedBlobUrl || resume.redactedData) && resume.redactedAt,
  );

  const useRedacted = wantsRedacted && hasRedacted;
  const bytes = useRedacted
    ? await getResumeBytes({ blobUrl: resume.redactedBlobUrl, data: resume.redactedData })
    : await getResumeBytes(resume);
  const mime = useRedacted ? (resume.redactedMimeType ?? "application/pdf") : resume.mimeType;
  const labelBase = (resume.displayName?.trim() || resume.filename).replace(/\.pdf$/i, "");
  const baseFilename = useRedacted
    ? `${labelBase}-redacted.pdf`
    : `${labelBase}.pdf`;
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
