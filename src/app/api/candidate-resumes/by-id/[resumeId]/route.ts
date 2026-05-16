import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";

export const dynamic = "force-dynamic";

// Phase 5A.5.a: fetches a specific CandidateResume row by id. Used by
// the version dropdown on the candidate profile when the recruiter
// picks an older version. The legacy `/api/candidate-resumes/[idOrRfId]`
// route still serves the most-recent version for back-compat URLs.
//
// Tenant scope: every read filters by organizationId via getCurrentOrg
// + the row's organizationId column. A forged resumeId from another
// tenant returns 404.
export async function GET(
  req: NextRequest,
  { params }: { params: { resumeId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new NextResponse("Unauthorized", { status: 401 });

  const org = await getCurrentOrg();
  const resume = await prisma.candidateResume.findFirst({
    where: { id: params.resumeId, organizationId: org.id, uploadComplete: true },
  });
  if (!resume) return new NextResponse("Not found", { status: 404 });

  const wantsRedacted = req.nextUrl.searchParams.get("variant") === "redacted";
  const hasRedacted = Boolean(resume.redactedData && resume.redactedAt);
  const useRedacted = wantsRedacted && hasRedacted;
  const bytes = useRedacted
    ? await getResumeBytes({ blobUrl: resume.redactedBlobUrl, data: resume.redactedData })
    : await getResumeBytes(resume);
  const mime = useRedacted ? (resume.redactedMimeType ?? "application/pdf") : resume.mimeType;
  // Phase 5A.5.b (Ace 20.0): pick the extension off the actual mime
  // type rather than hardcoding .pdf — DOCX downloads were landing as
  // {name}.pdf, which corrupted the file when the recruiter opened it.
  const extFromMime = (() => {
    if (mime === "application/pdf") return ".pdf";
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
    if (mime === "application/msword") return ".doc";
    if (mime === "text/plain") return ".txt";
    const m = resume.filename.match(/\.(pdf|docx?|txt)$/i);
    return m ? m[0].toLowerCase() : ".pdf";
  })();
  const labelBase = (resume.displayName?.trim() || resume.filename).replace(/\.(pdf|docx?|txt)$/i, "");
  const baseFilename = useRedacted
    ? `${labelBase}-redacted.pdf`
    : `${labelBase}${extFromMime}`;
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
