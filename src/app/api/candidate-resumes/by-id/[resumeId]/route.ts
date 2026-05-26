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
  // Post-Blob backfill: redactedData is null on migrated rows; bytes
  // moved to redactedBlobUrl. Either column counts as "has redacted".
  const hasRedacted = Boolean(
    (resume.redactedBlobUrl || resume.redactedData) && resume.redactedAt,
  );
  const useRedacted = wantsRedacted && hasRedacted;
  // Wrap the blob read so a Vercel Blob outage / 5xx / token-mismatch
  // surfaces as a clean JSON 500 instead of an unhandled exception that
  // hits Sentry as "Vercel Blob: Failed to fetch blob: 500 …" with no
  // context. Structured log captures the resumeId, variant, and blob
  // *host* (not the full URL — keeps signed tokens out of logs) so we
  // can triage by store / variant / id range without leaking creds.
  let bytes: Buffer;
  try {
    bytes = useRedacted
      ? await getResumeBytes({ blobUrl: resume.redactedBlobUrl, data: resume.redactedData })
      : await getResumeBytes(resume);
  } catch (err) {
    const failingUrl = useRedacted ? resume.redactedBlobUrl : resume.blobUrl;
    let blobHost = "no-url";
    if (failingUrl) {
      try {
        blobHost = new URL(failingUrl).hostname;
      } catch {
        blobHost = "malformed-url";
      }
    }
    console.error("[candidate-resume by-id] blob fetch failed", {
      resumeId: resume.id,
      variant: useRedacted ? "redacted" : "original",
      blobHost,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to fetch resume from storage.", resumeId: resume.id },
      { status: 500 },
    );
  }
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
