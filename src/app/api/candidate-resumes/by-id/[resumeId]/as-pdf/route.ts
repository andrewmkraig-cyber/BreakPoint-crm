import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";
import { convertDocxToPdfViaCloudConvert } from "@/lib/cloudconvert-docx-pdf";
import { convertDocxToPdfViaFreeRenderer } from "@/lib/free-docx-pdf";

export const dynamic = "force-dynamic";
// CloudConvert ?sync=true blocks up to 55s; keep the function alive.
export const maxDuration = 60;

// Serves any resume as PDF bytes for the in-browser canvas viewer.
// PDFs pass through unchanged. DOCX resumes are converted:
//   1. Serve a cached conversion row if one exists for this exact source,
//      preferring CloudConvert over the free preview-style renderer.
//   2. Try CloudConvert, then fall back to the free Mammoth HTML -> PDF
//      renderer. Both save as variant="converted:<sourceId>".
//
// Tenant scope: reads filter by organizationId via getCurrentOrg().

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";
const CLOUDCONVERT_DISPLAY_NAME = "Converted (CloudConvert)";
const FREE_CONVERT_DISPLAY_NAME = "Converted (Free)";

function isDocx(mimeType: string | null | undefined, filename: string): boolean {
  if (mimeType === DOCX_MIME || mimeType === LEGACY_DOC_MIME) return true;
  return /\.docx?$/i.test(filename);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { resumeId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const org = await getCurrentOrg();
  const resume = await prisma.candidateResume.findFirst({
    where: { id: params.resumeId, organizationId: org.id, uploadComplete: true },
  });
  if (!resume) return new NextResponse("Not found", { status: 404 });

  if (!isDocx(resume.mimeType, resume.filename)) {
    const sourceBytes = await getResumeBytes(resume);
    return new NextResponse(new Uint8Array(sourceBytes), {
      headers: {
        "Content-Type": resume.mimeType ?? "application/pdf",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // DOCX: serve cached conversion if one exists for this exact source.
  const cachedVariant = `converted:${resume.id}`;
  const cloudConvertConfigured = Boolean(process.env.CLOUDCONVERT_API_KEY?.trim());
  const cachedCloudConvert = await prisma.candidateResume.findFirst({
    where: {
      organizationId: org.id,
      variant: cachedVariant,
      displayName: CLOUDCONVERT_DISPLAY_NAME,
    },
  });
  const cached =
    cachedCloudConvert ??
    (await prisma.candidateResume.findFirst({
      where: {
        organizationId: org.id,
        variant: cachedVariant,
        displayName: FREE_CONVERT_DISPLAY_NAME,
      },
    }));
  if (cached && (cached.displayName !== FREE_CONVERT_DISPLAY_NAME || !cloudConvertConfigured)) {
    console.info("[as-pdf] using cached DOCX conversion", {
      sourceResumeId: resume.id,
      cachedResumeId: cached.id,
    });
    const cachedBytes = await getResumeBytes(cached);
    return new NextResponse(new Uint8Array(cachedBytes), {
      headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
    });
  }

  const sourceBytes = await getResumeBytes(resume);

  let pdfBytes: Buffer | null = null;
  let displayName = FREE_CONVERT_DISPLAY_NAME;
  try {
    console.info("[as-pdf] converting DOCX via CloudConvert", {
      sourceResumeId: resume.id,
      filename: resume.filename,
    });
    pdfBytes = await convertDocxToPdfViaCloudConvert(sourceBytes, resume.filename);
    if (pdfBytes) displayName = CLOUDCONVERT_DISPLAY_NAME;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[as-pdf] CloudConvert failed; using free converter", {
      sourceResumeId: resume.id,
      error: detail,
    });
  }

  if (!pdfBytes) {
    if (cached?.displayName === FREE_CONVERT_DISPLAY_NAME) {
      console.info("[as-pdf] using cached free DOCX conversion after CloudConvert miss", {
        sourceResumeId: resume.id,
        cachedResumeId: cached.id,
      });
      const cachedBytes = await getResumeBytes(cached);
      return new NextResponse(new Uint8Array(cachedBytes), {
        headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
      });
    }
    console.info("[as-pdf] converting DOCX via free renderer", {
      sourceResumeId: resume.id,
      filename: resume.filename,
    });
    try {
      pdfBytes = await convertDocxToPdfViaFreeRenderer(sourceBytes);
    } catch (err) {
      console.error("[as-pdf] free DOCX conversion failed", err);
      return new NextResponse("PDF conversion failed", { status: 500 });
    }
  }

  // Save so subsequent views and Edit Resume both hit the cached row.
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (user) {
    // Clean up stale fallback and legacy converted rows first.
    const candidateScope = resume.candidateId
      ? { candidateId: resume.candidateId }
      : resume.candidateRfId != null && resume.candidateRfId > 0
        ? { candidateRfId: resume.candidateRfId }
        : null;
    if (candidateScope) {
      await prisma.candidateResume.deleteMany({
        where: {
          organizationId: org.id,
          ...candidateScope,
          OR: [
            { variant: "converted" },
            { variant: { startsWith: "converted:" }, displayName: "Converted (fallback)" },
          ],
        },
      });
    }
    try {
      const baseName = resume.filename.replace(/\.docx?$/i, "");
      const ab = new ArrayBuffer(pdfBytes.byteLength);
      const dataArr = new Uint8Array(ab);
      dataArr.set(pdfBytes);
      await prisma.candidateResume.create({
        data: {
          candidateId: resume.candidateId,
          candidateRfId: resume.candidateRfId,
          organizationId: org.id,
          filename: `${baseName}.pdf`,
          displayName,
          mimeType: "application/pdf",
          size: pdfBytes.byteLength,
          data: dataArr,
          variant: cachedVariant,
          uploadComplete: true,
          uploadedById: user.id,
        },
      });
    } catch (err) {
      console.warn("[as-pdf] failed to cache CloudConvert PDF", {
        sourceResumeId: resume.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal: bytes are still served even if caching fails.
    }
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
