import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { brandResume, BrandResumeUnsupportedError } from "@/lib/resume-redactor";
import { getResumeBytes } from "@/lib/resume-bytes";

export const dynamic = "force-dynamic";
// pdfjs + pdf-lib on a multi-page resume can easily chew through the
// default Vercel 10s cap. Bump to the 30s tier used elsewhere.
export const maxDuration = 30;

// POST /api/redact-resume
// Body: { candidateId: string }
// Reads the candidate's original resume (Candidate.resumeData first, then
// CandidateResume.data), strips contact info, stamps the BreakPoint
// wordmark on page 1, and streams the branded file back for download.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { candidateId?: unknown };
  try {
    body = (await req.json()) as { candidateId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : null;
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      resumeFilename: true,
      resumeMimeType: true,
      resumeData: true,
    },
  });
  if (!candidate) {
    return NextResponse.json({ error: "candidate not found" }, { status: 404 });
  }

  // Prefer the inline resume; fall back to the CandidateResume table if
  // this candidate was imported before the inline storage path existed.
  let data: Uint8Array | null = null;
  let mimeType: string | null = null;
  let filename: string | null = null;
  if (candidate.resumeData && candidate.resumeMimeType) {
    data = new Uint8Array(candidate.resumeData);
    mimeType = candidate.resumeMimeType;
    filename = candidate.resumeFilename ?? "resume";
  } else {
    // Phase 5A.5.a: candidateId is no longer @unique; pick the most-
    // recent uploaded version as the redaction source.
    const cr = await prisma.candidateResume.findFirst({
      where: { candidateId: candidate.id, uploadComplete: true },
      orderBy: { uploadedAt: "desc" },
      select: { data: true, blobUrl: true, mimeType: true, filename: true, uploadComplete: true },
    });
    if (cr && cr.uploadComplete && (cr.blobUrl || cr.data)) {
      data = new Uint8Array(await getResumeBytes(cr));
      mimeType = cr.mimeType;
      filename = cr.filename;
    }
  }

  if (!data || !mimeType) {
    return NextResponse.json(
      { error: "no resume on file for this candidate" },
      { status: 404 },
    );
  }

  const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || null;

  try {
    const out = await brandResume({
      data,
      mimeType,
      filename: filename ?? "resume",
      candidateName: fullName,
    });

    // Log the redaction report to stdout — Sentry breadcrumbs will pick it
    // up, and the unsure-lines list is exactly the audit trail the spec
    // asked for ("be conservative — if unsure, leave it and log").
    // eslint-disable-next-line no-console
    console.log("[brand-resume] completed", {
      candidateId: candidate.id,
      format: out.report.kind,
      report: out.report.detail,
    });

    // Buffer.from(Uint8Array) matches NextResponse's expected BodyInit and
    // works across the lib's differing typed-array generic parameters.
    return new NextResponse(Buffer.from(out.bytes), {
      status: 200,
      headers: {
        "Content-Type": out.mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(out.filename)}"`,
        "Cache-Control": "private, no-store",
        "X-Redactions": String(
          out.report.kind === "pdf"
            ? out.report.detail.redactions
            : out.report.detail.linesRedacted,
        ),
        "X-Logo-Stamped": out.report.kind === "pdf"
          ? String(out.report.detail.logoStamped)
          : String(out.report.detail.logoStamped),
      },
    });
  } catch (err) {
    if (err instanceof BrandResumeUnsupportedError) {
      return NextResponse.json({ error: err.message }, { status: 415 });
    }
    // eslint-disable-next-line no-console
    console.error("[brand-resume] failed", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `branding failed: ${msg}` }, { status: 500 });
  }
}
