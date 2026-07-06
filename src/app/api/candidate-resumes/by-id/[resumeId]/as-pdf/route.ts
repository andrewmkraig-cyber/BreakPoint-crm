import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";
import { convertDocxToPdfViaCloudConvert } from "@/lib/cloudconvert-docx-pdf";

export const dynamic = "force-dynamic";
// CloudConvert ?sync=true blocks up to 55s; keep the function alive.
export const maxDuration = 60;

// Serves any resume as PDF bytes for the in-browser canvas viewer.
// PDFs pass through unchanged. DOCX resumes are converted:
//   1. Serve a cached CloudConvert row if one exists for this exact source.
//   2. Call CloudConvert, save the result as variant="converted:<sourceId>",
//      and serve it — subsequent views hit the cache, not the API.
//   3. Fallback: mammoth+pdf-lib reflow (ephemeral, not saved).
//
// Tenant scope: reads filter by organizationId via getCurrentOrg().

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

function isDocx(mimeType: string | null | undefined, filename: string): boolean {
  if (mimeType === DOCX_MIME || mimeType === LEGACY_DOC_MIME) return true;
  return /\.docx?$/i.test(filename);
}

async function docxToPlainTextPdf(sourceBytes: Buffer): Promise<Buffer> {
  const mammoth = await import("mammoth");
  const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
  if (!extract) throw new Error("DOCX extractor unavailable");
  const { value: rawText } = await extract({ buffer: sourceBytes });
  const text = (rawText ?? "").replace(/\r\n/g, "\n");

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const lineHeight = fontSize * 1.4;
  const margin = 54;
  const pageWidth = 612;
  const pageHeight = 792;
  const usableWidth = pageWidth - margin * 2;
  const black = rgb(0, 0, 0);

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin - fontSize;

  const ensureSpace = () => {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin - fontSize;
    }
  };

  const drawLine = (line: string) => {
    ensureSpace();
    const safe = line.replace(/[^\x00-\x7F]/g, (c) => {
      try {
        font.widthOfTextAtSize(c, fontSize);
        return c;
      } catch {
        return "?";
      }
    });
    page.drawText(safe, { x: margin, y, size: fontSize, font, color: black });
    y -= lineHeight;
  };

  for (const paragraph of text.split(/\n+/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      y -= lineHeight;
      continue;
    }
    const words = trimmed.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      let width: number;
      try {
        width = font.widthOfTextAtSize(candidate, fontSize);
      } catch {
        width = candidate.length * fontSize * 0.6;
      }
      if (width > usableWidth && line) {
        drawLine(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) drawLine(line);
    y -= lineHeight * 0.3;
  }

  return Buffer.from(await pdf.save());
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

  // DOCX: serve cached CloudConvert PDF if one exists for this exact source.
  const cachedVariant = `converted:${resume.id}`;
  const cached = await prisma.candidateResume.findFirst({
    where: {
      organizationId: org.id,
      variant: cachedVariant,
      displayName: "Converted (CloudConvert)",
    },
  });
  if (cached) {
    const cachedBytes = await getResumeBytes(cached);
    return new NextResponse(new Uint8Array(cachedBytes), {
      headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
    });
  }

  const sourceBytes = await getResumeBytes(resume);

  let pdfBytes: Buffer | null = null;
  try {
    pdfBytes = await convertDocxToPdfViaCloudConvert(sourceBytes, resume.filename);
  } catch {
    // fall through to mammoth reflow
  }

  if (pdfBytes) {
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
            displayName: "Converted (CloudConvert)",
            mimeType: "application/pdf",
            size: pdfBytes.byteLength,
            data: dataArr,
            variant: cachedVariant,
            uploadComplete: true,
            uploadedById: user.id,
          },
        });
      } catch {
        // Non-fatal: bytes are still served even if caching fails.
      }
    }
  } else {
    try {
      pdfBytes = await docxToPlainTextPdf(sourceBytes);
    } catch (err) {
      console.error("[as-pdf] mammoth reflow failed", err);
      return new NextResponse("PDF conversion failed", { status: 500 });
    }
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
