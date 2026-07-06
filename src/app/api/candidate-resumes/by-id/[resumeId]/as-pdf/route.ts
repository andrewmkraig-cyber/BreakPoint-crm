import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";
import { convertDocxToPdfViaCloudConvert } from "@/lib/cloudconvert-docx-pdf";

export const dynamic = "force-dynamic";
// CloudConvert ?sync=true blocks until the job finishes (typically 10-30s).
// Without maxDuration Vercel kills the function at the platform default (10s
// on Hobby, 60s on Pro) and stdout may not be flushed — that is why logs
// stopped after "route hit". Setting 60 explicitly keeps Pro routes alive
// long enough for conversion and flushes all pending log lines before exit.
export const maxDuration = 60;

// Serves any resume as PDF bytes for the in-browser canvas viewer.
// PDFs are passed through unchanged. DOCX resumes are converted on-the-fly:
//   1. CloudConvert HTTPS API (CLOUDCONVERT_API_KEY) - faithful, formatting-preserving.
//   2. mammoth+pdf-lib reflow - plain text fallback when key is absent or API fails.
//
// No database row is created; this is display-only. The Edit Resume flow
// goes through convertDocxResumeToPdf (actions.ts) which saves a persistent
// variant="converted" row.
//
// Tenant scope: reads filter by organizationId via getCurrentOrg().

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

function isDocx(mimeType: string | null | undefined, filename: string): boolean {
  if (mimeType === DOCX_MIME || mimeType === LEGACY_DOC_MIME) return true;
  return /\.docx?$/i.test(filename);
}

// Plain-text reflow fallback. Used when CloudConvert key is absent or fails.
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

  const docxFlag = isDocx(resume.mimeType, resume.filename);

  // Log BEFORE getResumeBytes so this fires at ~0.5s (after auth+DB) not
  // ~9.5s (after blob download). In 96.1 the log was after getResumeBytes;
  // if the blob download consumed most of the function's budget the log and
  // everything that followed fired too late for Vercel's log collector to
  // flush before the SIGKILL, making all subsequent logs silently disappear.
  // eslint-disable-next-line no-console
  console.log(
    "[docx-convert-diag] as-pdf route hit | resumeId:", params.resumeId,
    "| mimeType:", resume.mimeType,
    "| filename:", resume.filename,
    "| variant:", resume.variant,
    "| isDocx:", docxFlag,
    "| key present:", !!process.env.CLOUDCONVERT_API_KEY,
  );

  if (!docxFlag) {
    // Already a PDF or other type - pass through.
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] not a docx, serving bytes directly | mimeType:", resume.mimeType);
    const sourceBytes = await getResumeBytes(resume);
    return new NextResponse(new Uint8Array(sourceBytes), {
      headers: {
        "Content-Type": resume.mimeType ?? "application/pdf",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // DOCX path: log the CloudConvert intention BEFORE the blob download so
  // this line is always visible in Vercel logs even if getResumeBytes hangs.
  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] docx confirmed, fetching bytes then calling CloudConvert");
  const sourceBytes = await getResumeBytes(resume);
  // eslint-disable-next-line no-console
  console.log("[docx-convert-diag] bytes ready | byteLength:", sourceBytes.byteLength);

  // Convert DOCX to PDF.
  let pdfBytes: Buffer | null = null;
  try {
    pdfBytes = await convertDocxToPdfViaCloudConvert(sourceBytes, resume.filename);
    // eslint-disable-next-line no-console
    console.log(
      "[docx-convert-diag] helper returned:",
      pdfBytes ? `${pdfBytes.byteLength} bytes (CloudConvert)` : "null (will use fallback)",
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(
      "[docx-convert-diag] CloudConvert threw, falling back to reflow |",
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }

  if (!pdfBytes) {
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] using mammoth reflow fallback (CloudConvert returned null or threw)");
    try {
      pdfBytes = await docxToPlainTextPdf(sourceBytes);
    } catch (err) {
      console.error("[as-pdf] mammoth reflow failed", err);
      return new NextResponse("PDF conversion failed", { status: 500 });
    }
  } else {
    // eslint-disable-next-line no-console
    console.log("[docx-convert-diag] CloudConvert succeeded, serving faithful PDF");
  }

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
