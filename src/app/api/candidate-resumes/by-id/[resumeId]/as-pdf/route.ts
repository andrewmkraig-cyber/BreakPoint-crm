import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";
import { convertDocxToPdfViaCloudConvert } from "@/lib/cloudconvert-docx-pdf";
import {
  convertDocxToPdfViaLibreOffice,
  isDocxMimeOrName,
} from "@/lib/libreoffice-docx-pdf";

export const dynamic = "force-dynamic";
// CloudConvert's sync endpoint blocks up to 55s; keep the function alive.
export const maxDuration = 60;

// Serves any resume as PDF bytes for the in-browser canvas viewer.
// PDFs pass through unchanged. DOCX resumes are converted:
//   1. Serve a cached conversion row if one exists for this exact source,
//      preferring CloudConvert over the local LibreOffice converter.
//   2. Try CloudConvert, then fall back to LibreOffice/soffice. Both save
//      as variant="converted:<sourceId>".
//
// Tenant scope: reads filter by organizationId via getCurrentOrg().

const CLOUDCONVERT_DISPLAY_NAME = "Converted (CloudConvert)";
const LIBREOFFICE_DISPLAY_NAME = "Converted (LibreOffice)";
const STALE_CONVERT_DISPLAY_NAMES = ["Converted (Free)", "Converted (fallback)"];

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

  if (!isDocxMimeOrName(resume.mimeType, resume.filename)) {
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
        displayName: LIBREOFFICE_DISPLAY_NAME,
      },
    }));
  if (cached) {
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
  let displayName = CLOUDCONVERT_DISPLAY_NAME;
  let cloudConvertError: string | null = null;
  try {
    console.info("[as-pdf] converting DOCX via CloudConvert", {
      sourceResumeId: resume.id,
      filename: resume.filename,
    });
    pdfBytes = await convertDocxToPdfViaCloudConvert(sourceBytes, resume.filename);
    if (pdfBytes) displayName = CLOUDCONVERT_DISPLAY_NAME;
    else {
      console.info("[as-pdf] CloudConvert key missing; trying LibreOffice", {
        sourceResumeId: resume.id,
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    cloudConvertError = detail;
    console.warn("[as-pdf] CloudConvert failed; trying LibreOffice", {
      sourceResumeId: resume.id,
      error: detail,
    });
  }

  if (!pdfBytes) {
    console.info("[as-pdf] converting DOCX via LibreOffice", {
      sourceResumeId: resume.id,
      filename: resume.filename,
    });
    try {
      const converted = await convertDocxToPdfViaLibreOffice(sourceBytes, resume.filename);
      if (!converted) {
        const detail = cloudConvertError
          ? `CloudConvert failed (${cloudConvertError}) and LibreOffice is not available.`
          : "CloudConvert is not configured and LibreOffice is not available.";
        console.warn("[as-pdf] DOCX conversion unavailable", {
          sourceResumeId: resume.id,
          detail,
        });
        return new NextResponse(`PDF conversion unavailable: ${detail}`, { status: 422 });
      }
      pdfBytes = converted;
      displayName = LIBREOFFICE_DISPLAY_NAME;
    } catch (err) {
      console.error("[as-pdf] LibreOffice DOCX conversion failed", {
        sourceResumeId: resume.id,
        error: err instanceof Error ? err.message : String(err),
      });
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
            {
              variant: { startsWith: "converted:" },
              displayName: { in: STALE_CONVERT_DISPLAY_NAMES },
            },
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
      console.warn("[as-pdf] failed to cache converted PDF", {
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
