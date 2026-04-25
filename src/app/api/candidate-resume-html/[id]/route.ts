import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Serves a .docx resume as inline HTML for the profile preview. One route
// handles both Ace-native candidates (resume stored on Candidate.resumeData)
// and RF-imported candidates (resume stored in CandidateResume). The path
// segment can be a Candidate cuid OR a legacy numeric rfId — matches the
// resolver behavior of /api/candidate-resumes/[candidateRfId].
//
// Response shape: { html } on success, { error } with 404/415 otherwise.
// Kept narrow on purpose: PDFs go through the canvas viewer, not this route.

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

function isDocx(filename: string | null | undefined, mimeType: string | null | undefined): boolean {
  if (mimeType === DOCX_MIME || mimeType === LEGACY_DOC_MIME) return true;
  const f = (filename ?? "").toLowerCase();
  return f.endsWith(".docx") || f.endsWith(".doc");
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = params.id;
  const candidate = /^\d+$/.test(raw)
    ? await prisma.candidate.findFirst({ where: { rfId: Number(raw) }, select: { id: true } })
    : await prisma.candidate.findFirst({ where: { id: raw }, select: { id: true } });
  if (!candidate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Prefer CandidateResume (RF-imported path); fall back to inline
  // Candidate.resumeData (Ace-native upload path). Phase 5A.5.a:
  // candidateId is no longer @unique — pick the most-recent uploaded
  // version for the docx-html preview.
  const cr = await prisma.candidateResume.findFirst({
    where: { candidateId: candidate.id, uploadComplete: true },
    orderBy: { uploadedAt: "desc" },
  });

  let bytes: Buffer | null = null;
  let filename: string | null = null;
  let mimeType: string | null = null;
  if (cr && cr.uploadComplete) {
    bytes = Buffer.from(cr.data);
    filename = cr.filename;
    mimeType = cr.mimeType;
  } else {
    const local = await prisma.candidate.findUnique({
      where: { id: candidate.id },
      select: { resumeData: true, resumeFilename: true, resumeMimeType: true },
    });
    if (local?.resumeData) {
      bytes = Buffer.from(local.resumeData);
      filename = local.resumeFilename;
      mimeType = local.resumeMimeType;
    }
  }

  if (!bytes) {
    return NextResponse.json({ error: "No resume on file" }, { status: 404 });
  }
  if (!isDocx(filename, mimeType)) {
    return NextResponse.json({ error: "Not a docx" }, { status: 415 });
  }

  try {
    const mammoth = await import("mammoth");
    const convert = mammoth.convertToHtml ?? mammoth.default?.convertToHtml;
    if (typeof convert !== "function") {
      return NextResponse.json({ error: "Converter unavailable" }, { status: 500 });
    }
    const result = await convert({ buffer: bytes });
    const html = result.value ?? "";
    return NextResponse.json({ html });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Conversion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
