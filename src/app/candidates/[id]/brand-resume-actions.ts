"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { put } from "@vercel/blob";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { BRAND_LOGO_TRANSPARENT_BASE64 } from "@/lib/default-brand-logo";
import { getResumeBytes } from "@/lib/resume-bytes";

// Phase 5A.5.b — server action that produces a derivative PDF from a
// source CandidateResume. The unified Edit Resume modal sends both
// logo placements and redaction rects in one payload; the server runs
// them through pdf-lib in a single pass and writes the result as a new
// CandidateResume row. The variant column records which transforms
// were applied so the dropdown labels stay accurate.
//
// Tenant scope: every read/write filters by organizationId via
// getCurrentOrg() and the source row's organizationId.

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

export type BrandPlacement = {
  // 0-based page index in the PDF.
  pageIndex: number;
  // Logo top-left, normalized to the page's rendered (CSS) size.
  // x=0 is left edge, y=0 is top edge of the page.
  xNorm: number;
  yNorm: number;
  // Target logo width in CSS pixels at the rendered scale that the
  // editor used. The server scales it to PDF points using the page's
  // PDF-points width / its render width ratio.
  widthPx: number;
};

export type RedactionRect = {
  // 0-based page index in the PDF.
  pageIndex: number;
  // Top-left corner + size, normalized to the page's rendered size
  // (0..1). The editor uses CSS top-left coordinates; we flip to
  // pdf-lib's bottom-left origin server-side.
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
};

export type BrandResumeInput = {
  // Source resume row to derive from. The result is stored as a NEW
  // CandidateResume row referencing the same candidate.
  sourceResumeId: string;
  // Render scale that the client used when computing xNorm / yNorm
  // (so we know the rendered page width, used to convert logo widthPx
  // back to PDF points).
  renderedPageWidthPx: number;
  placements: BrandPlacement[];
  redactions: RedactionRect[];
};

async function requireUserId(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true },
  });
  return u?.id ?? null;
}

export async function brandCandidateResume(
  input: BrandResumeInput,
): Promise<ActionResult<{ resumeId: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!input.sourceResumeId) return { ok: false, error: "Missing source resume id." };
  if (input.placements.length === 0 && input.redactions.length === 0) {
    return {
      ok: false,
      error: "Place the logo or draw a redaction box before saving.",
    };
  }
  if (!Number.isFinite(input.renderedPageWidthPx) || input.renderedPageWidthPx <= 0) {
    return { ok: false, error: "Invalid render scale." };
  }

  try {
    const org = await getCurrentOrg();
    const source = await prisma.candidateResume.findFirst({
      where: { id: input.sourceResumeId, organizationId: org.id },
    });
    if (!source) return { ok: false, error: "Source resume not found." };
    if (source.mimeType !== "application/pdf") {
      return { ok: false, error: "Editing only supports PDFs today." };
    }

    // pdf-lib is heavy (~1MB). Lazy-load to keep the rest of the
    // server-action bundle small.
    const { PDFDocument, rgb } = await import("pdf-lib");
    const sourceBytes = await getResumeBytes(source);
    const pdf = await PDFDocument.load(sourceBytes);
    const pages = pdf.getPages();

    // Apply redactions first so the logo stamps land on top of any
    // covered area (matches the on-canvas stack the user sees in the
    // editor: logo overlay above redaction rects).
    for (const rect of input.redactions) {
      if (rect.pageIndex < 0 || rect.pageIndex >= pages.length) continue;
      const page = pages[rect.pageIndex];
      const { width, height } = page.getSize();
      const x = rect.xNorm * width;
      const yTop = rect.yNorm * height;
      const rectW = rect.wNorm * width;
      const rectH = rect.hNorm * height;
      page.drawRectangle({
        x,
        y: height - yTop - rectH,
        width: rectW,
        height: rectH,
        color: rgb(1, 1, 1),
        borderColor: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }

    if (input.placements.length > 0) {
      const logoBytes = Buffer.from(BRAND_LOGO_TRANSPARENT_BASE64, "base64");
      const logo = await pdf.embedPng(logoBytes);
      const logoAspect = logo.height / logo.width;
      for (const p of input.placements) {
        if (p.pageIndex < 0 || p.pageIndex >= pages.length) continue;
        const page = pages[p.pageIndex];
        const { width: pdfW, height: pdfH } = page.getSize();
        const widthPoints = (p.widthPx / input.renderedPageWidthPx) * pdfW;
        const heightPoints = widthPoints * logoAspect;
        const xPoints = p.xNorm * pdfW;
        const yPointsTopLeft = p.yNorm * pdfH;
        const yPointsBottomLeft = pdfH - yPointsTopLeft - heightPoints;
        page.drawImage(logo, {
          x: xPoints,
          y: yPointsBottomLeft,
          width: widthPoints,
          height: heightPoints,
        });
      }
    }

    const outputBytes = await pdf.save();

    const variant =
      input.placements.length > 0 && input.redactions.length > 0
        ? "branded-redacted"
        : input.placements.length > 0
          ? "branded"
          : "redacted";

    const baseName =
      (source.displayName?.trim() || source.filename).replace(/\.(pdf|docx?|txt)$/i, "");
    const filename =
      variant === "redacted"
        ? `${baseName} - redacted.pdf`
        : `${baseName} - BreakPoint.pdf`;

    // candidateId is nullable on CandidateResume; fall back to the
    // source row id so the blob path is always unique.
    const candidateIdForPath = source.candidateId ?? source.id;
    const blob = await put(
      `resumes/${candidateIdForPath}/branded-${filename}`,
      Buffer.from(outputBytes),
      { access: "private", contentType: "application/pdf", addRandomSuffix: true },
    );

    const created = await prisma.candidateResume.create({
      data: {
        candidateId: source.candidateId,
        candidateRfId: source.candidateRfId,
        organizationId: org.id,
        filename,
        mimeType: "application/pdf",
        size: outputBytes.byteLength,
        data: Buffer.alloc(0),
        blobUrl: blob.url,
        variant,
        uploadComplete: true,
        uploadedById: userId,
      },
      select: { id: true },
    });

    if (source.candidateId) revalidatePath(`/candidates/${source.candidateId}`);
    if (source.candidateRfId != null && source.candidateRfId > 0) revalidatePath(`/candidates/${source.candidateRfId}`);
    return { ok: true, value: { resumeId: created.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save resume version." };
  }
}
