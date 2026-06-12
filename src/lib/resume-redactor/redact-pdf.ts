// Server-side PDF redactor + brand stamper.
//
// Strategy:
//   1. Use pdfjs-dist (legacy Node build) to extract every text item with its
//      page-space bounding box.
//   2. Match each text item against PII regexes (email, phone, LinkedIn,
//      URLs, physical addresses). Keep the candidate's name.
//   3. Cover matched items with filled rectangles in the page's fill color
//      (default white) using pdf-lib.
//   4. Stamp the BreakPoint brand mark in the top-right of page 1 only.
//
// Non-goals: rasterization, OCR of image-only PDFs. If the source has no
// extractable text, the redactor returns the original bytes with only the
// brand stamp applied and records that no redactions were made.
//
// Known limitation: redaction is *visual* — white rectangles cover PII
// but the underlying text stream is preserved, so copy/paste from the
// rendered PDF can still recover the covered strings. This matches the
// existing manual ResumeRedactor pattern in the codebase. For data-level
// stripping use the docx path (it rebuilds the document from scratch).
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type RedactionReport = {
  redactions: number;
  pagesScanned: number;
  logoStamped: boolean;
  unsureLines: string[];
  textExtractionFailed: boolean;
};

export type RedactPdfResult = {
  bytes: Uint8Array;
  report: RedactionReport;
};

type TextItemPos = {
  text: string;
  // PDF-space: origin bottom-left. x,y are baseline left.
  x: number;
  y: number;
  width: number;
  height: number;
};

// Logo footprint in PDF points. Task spec: width 80px, 15pt from right,
// 10pt from top. We treat "px" here as PDF points since the stamp is
// applied directly to PDF page coordinates.
const LOGO_WIDTH_PT = 80;
const LOGO_MARGIN_RIGHT_PT = 15;
const LOGO_MARGIN_TOP_PT = 10;
const LOGO_ASPECT_RATIO = 0.32; // height/width for the wordmark

export async function redactPdf(
  input: Uint8Array,
  opts: { candidateName?: string | null } = {},
): Promise<RedactPdfResult> {
  const report: RedactionReport = {
    redactions: 0,
    pagesScanned: 0,
    logoStamped: false,
    unsureLines: [],
    textExtractionFailed: false,
  };

  // Load once with pdf-lib for writing.
  const pdfDoc = await PDFDocument.load(input);
  const pages = pdfDoc.getPages();
  report.pagesScanned = pages.length;

  // Extract text positions with pdfjs. We copy input because pdfjs may take
  // ownership of the buffer (it transfers ArrayBuffers for worker use).
  const pdfjsBytes = new Uint8Array(input.byteLength);
  pdfjsBytes.set(input);

  let itemsByPage: TextItemPos[][] = [];
  try {
    itemsByPage = await extractTextItemsByPage(pdfjsBytes, pages.length);
  } catch (err) {
    report.textExtractionFailed = true;
    // eslint-disable-next-line no-console
    console.warn("[redact-pdf] text extraction failed", err);
  }

  const nameTokens = tokenizeName(opts.candidateName ?? null);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const items = itemsByPage[i] ?? [];
    const decisions = decideRedactions(items, nameTokens);
    for (const d of decisions.redact) {
      drawCover(page, d);
      report.redactions++;
    }
    report.unsureLines.push(...decisions.unsure);
  }

  // Stamp logo on page 1 only.
  if (pages.length > 0) {
    const stamped = await stampLogoOnPage1(pdfDoc, pages[0], itemsByPage[0] ?? []);
    report.logoStamped = stamped;
  }

  const bytes = await pdfDoc.save();
  return { bytes, report };
}

async function extractTextItemsByPage(
  data: Uint8Array,
  expectedPages: number,
): Promise<TextItemPos[][]> {
  // Install our pure-JS DOMMatrix before pdfjs imports — the legacy Node
  // build constructs `new DOMMatrix()` at module-eval and would otherwise
  // throw "DOMMatrix is not defined" in the Vercel lambda (where the native
  // @napi-rs/canvas polyfill source does not load). See pdf-node-globals.ts.
  const { ensurePdfNodeGlobals } = await import("@/lib/pdf-node-globals");
  ensurePdfNodeGlobals();
  // Import the worker so globalThis.pdfjsWorker is set; otherwise pdfjs's Node
  // fake-worker path dynamically imports workerSrc ("./pdf.worker.mjs"), which
  // is not traced into the Vercel lambda ("Setting up fake worker failed").
  // See pdf-node-globals.ts.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  // Use legacy build for Node. Disable worker and font loading warnings.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs in Node: no worker, no DOM. disableFontFace stops it from trying
  // to register fonts with the page; we only need text content.
  const loadingTask = (pdfjs as unknown as {
    getDocument: (args: {
      data: Uint8Array;
      useSystemFonts?: boolean;
      disableFontFace?: boolean;
      isEvalSupported?: boolean;
    }) => { promise: Promise<PdfJsDoc> };
  }).getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pageCount = Math.min(doc.numPages, expectedPages);
  const out: TextItemPos[][] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const viewport = page.getViewport({ scale: 1 });
    // pdfjs transforms: [a, b, c, d, e, f] where e,f is origin.
    // For unrotated pages that matches PDF points directly.
    const pageItems: TextItemPos[] = [];
    for (const raw of content.items) {
      const item = raw as unknown as PdfJsTextItem;
      const str = item.str;
      if (!str) continue;
      // transform[4],[5] = x,y in page-space (bottom-left origin).
      // item.height / item.width are in page units.
      const x = item.transform[4];
      const yBaseline = item.transform[5];
      const height = item.height || Math.abs(item.transform[3]) || 10;
      const width = item.width || 0;
      pageItems.push({
        text: str,
        x,
        y: yBaseline,
        width,
        height,
      });
    }
    // Close page resources.
    if (typeof page.cleanup === "function") page.cleanup();
    out.push(pageItems);
    void viewport;
  }
  if (typeof doc.cleanup === "function") doc.cleanup();
  return out;
}

// Inline types matching pdfjs's getDocument return shape — keeps us out of
// pdfjs's generated d.ts (which has DOM assumptions we don't want in Node).
type PdfJsTextItem = {
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
};
type PdfJsDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: (args: { includeMarkedContent: boolean }) => Promise<{
      items: unknown[];
    }>;
    getViewport: (args: { scale: number }) => { width: number; height: number };
    cleanup?: () => void;
  }>;
  cleanup?: () => void;
};

type RedactionDecision = {
  item: TextItemPos;
  reason: string;
};

function decideRedactions(
  items: TextItemPos[],
  nameTokens: Set<string>,
): { redact: RedactionDecision[]; unsure: string[] } {
  // Group items into visual lines by baseline y (within 2pt) so we can
  // pattern-match multi-item lines (e.g., "Cleveland, OH 44113" may split
  // across 3 pdfjs text items).
  const lines = groupIntoLines(items);
  const redact: RedactionDecision[] = [];
  const unsure: string[] = [];

  for (const line of lines) {
    const joined = line.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim();
    if (!joined) continue;

    // Never redact the candidate's name.
    if (isNameLine(joined, nameTokens)) continue;

    const classification = classifyLine(joined);
    if (classification === "pii") {
      for (const item of line) redact.push({ item, reason: "pii-line" });
      continue;
    }
    if (classification === "unsure") {
      unsure.push(joined);
      continue;
    }

    // classification === "clean": still scan individual items for embedded
    // PII (e.g., an email inside a larger paragraph).
    for (const item of line) {
      const t = item.text.trim();
      if (!t) continue;
      if (itemIsPii(t)) redact.push({ item, reason: "pii-item" });
    }
  }

  return { redact, unsure };
}

function groupIntoLines(items: TextItemPos[]): TextItemPos[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 2) return b.y - a.y; // top-down
    return a.x - b.x;
  });
  const lines: TextItemPos[][] = [];
  let current: TextItemPos[] = [];
  let currentY: number | null = null;
  for (const it of sorted) {
    if (currentY === null || Math.abs(it.y - currentY) <= 2) {
      current.push(it);
      currentY = currentY === null ? it.y : currentY;
    } else {
      lines.push(current);
      current = [it];
      currentY = it.y;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function tokenizeName(name: string | null): Set<string> {
  const out = new Set<string>();
  if (!name) return out;
  for (const part of name.split(/\s+/)) {
    const clean = part.replace(/[^A-Za-z'\-]/g, "").toLowerCase();
    if (clean.length >= 2) out.add(clean);
  }
  return out;
}

function isNameLine(line: string, nameTokens: Set<string>): boolean {
  if (nameTokens.size === 0) return false;
  const tokens = line
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z'\-]/g, "").toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  let matched = 0;
  for (const t of tokens) if (nameTokens.has(t)) matched++;
  // Treat as a name line if the majority of tokens come from the known
  // name — handles "Jane A. Smith" matching "Jane Smith".
  return matched >= Math.min(2, nameTokens.size) || matched / tokens.length >= 0.6;
}

type LineClass = "pii" | "unsure" | "clean";

// Line-level classifier. Returns "pii" for definite contact info that
// should be covered, "unsure" for suspicious but ambiguous lines (logged
// but left untouched), "clean" otherwise.
function classifyLine(line: string): LineClass {
  if (EMAIL_RE.test(line)) return "pii";
  if (PHONE_RE.test(line)) return "pii";
  if (LINKEDIN_RE.test(line)) return "pii";
  if (PERSONAL_URL_RE.test(line)) return "pii";
  if (STREET_ADDRESS_RE.test(line)) return "pii";
  if (CITY_STATE_ZIP_RE.test(line)) return "pii";
  // "Contact" heading lines are usually safe to drop but ambiguous —
  // flag for the unsure log so the reviewer can decide.
  if (/^(contact|personal|get in touch|reach me)\b/i.test(line) && line.length < 40) {
    return "unsure";
  }
  return "clean";
}

function itemIsPii(text: string): boolean {
  return (
    EMAIL_RE.test(text) ||
    PHONE_RE.test(text) ||
    LINKEDIN_RE.test(text) ||
    PERSONAL_URL_RE.test(text)
  );
}

// PII regexes. Kept conservative: we'd rather skip a borderline item than
// redact something legitimate (project names with numbers, company URLs
// in the employer list, etc.).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE =
  /(?:\+?\d{1,2}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]+\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_\-%]+\/?/i;
// Personal website URLs — we skip common corporate / project hosting
// domains since those usually live in the experience section.
const PERSONAL_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9\-]+\.(?:me|io|dev|xyz|site|online|personal|tech)\b/i;
const STREET_ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z][A-Za-z\s\.]*\b(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Way|Court|Ct\.?|Place|Pl\.?|Parkway|Pkwy\.?)\b/i;
const CITY_STATE_ZIP_RE =
  /\b[A-Z][A-Za-z\-\.\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;

function drawCover(page: PDFPage, d: RedactionDecision) {
  const { item } = d;
  // pdfjs reports baseline y and a height that's roughly the font size.
  // Expand by 20% vertically and center on the baseline so ascenders +
  // descenders are fully covered without eating the line above.
  const pad = Math.max(1.5, item.height * 0.2);
  const yBottom = item.y - pad;
  const height = item.height + pad * 2;
  // If width is 0 (some items don't report width), fall back to a rough
  // estimate from text length and height.
  const width = item.width > 0 ? item.width : item.text.length * item.height * 0.55;
  page.drawRectangle({
    x: item.x - 0.5,
    y: yBottom,
    width: width + 1,
    height,
    color: rgb(1, 1, 1),
    opacity: 1,
  });
}

async function stampLogoOnPage1(
  pdfDoc: PDFDocument,
  page: PDFPage,
  items: TextItemPos[],
): Promise<boolean> {
  const { width, height } = page.getSize();
  const logoW = LOGO_WIDTH_PT;
  const logoH = LOGO_WIDTH_PT * LOGO_ASPECT_RATIO;
  const x = width - LOGO_MARGIN_RIGHT_PT - logoW;
  const y = height - LOGO_MARGIN_TOP_PT - logoH;

  // Abort if there's existing text in the target stamp box — we'd rather
  // skip the stamp than overlay a name or header.
  const box = { x, y, x2: x + logoW, y2: y + logoH };
  for (const it of items) {
    const itX2 = it.x + (it.width > 0 ? it.width : it.text.length * 4);
    const itY2 = it.y + it.height;
    const overlap =
      it.x < box.x2 && itX2 > box.x && it.y < box.y2 && itY2 > box.y;
    if (overlap) {
      // eslint-disable-next-line no-console
      console.warn("[redact-pdf] skipping logo stamp: existing text in stamp region");
      return false;
    }
  }

  // Try to embed a PNG logo first; fall back to a vector wordmark.
  const png = await loadLogoPng();
  if (png) {
    const embedded = await pdfDoc.embedPng(png);
    const scale = logoW / embedded.width;
    page.drawImage(embedded, {
      x,
      y: height - LOGO_MARGIN_TOP_PT - embedded.height * scale,
      width: logoW,
      height: embedded.height * scale,
    });
    return true;
  }

  await drawVectorWordmark(pdfDoc, page, x, y, logoW, logoH);
  return true;
}

async function drawVectorWordmark(
  pdfDoc: PDFDocument,
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  // Navy background behind the wordmark so it reads on any page color.
  // Colors from tailwind.config.ts: navy #111111, brand green #5A9642.
  const navy = rgb(0x0f / 255, 0x1b / 255, 0x2d / 255);
  const green = rgb(0x5a / 255, 0x96 / 255, 0x42 / 255);
  page.drawRectangle({ x, y, width: w, height: h, color: navy });
  // Green accent bar on the left.
  page.drawRectangle({ x, y, width: 3, height: h, color: green });
  // "BreakPoint" on line 1, "Talent" on line 2, fitting within w.
  const topSize = Math.min(10, h * 0.42);
  const botSize = Math.min(7, h * 0.3);
  const topText = "BreakPoint";
  const botText = "Talent";
  const topWidth = helvBold.widthOfTextAtSize(topText, topSize);
  const botWidth = helv.widthOfTextAtSize(botText, botSize);
  page.drawText(topText, {
    x: x + (w - topWidth) / 2 + 1.5,
    y: y + h * 0.52,
    size: topSize,
    font: helvBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(botText, {
    x: x + (w - botWidth) / 2 + 1.5,
    y: y + h * 0.18,
    size: botSize,
    font: helv,
    color: green,
  });
}

let cachedLogoPng: Uint8Array | null | undefined;
async function loadLogoPng(): Promise<Uint8Array | null> {
  if (cachedLogoPng !== undefined) return cachedLogoPng;
  try {
    const p = path.join(process.cwd(), "public", "brand", "breakpoint-logo.png");
    const buf = await readFile(p);
    cachedLogoPng = new Uint8Array(buf);
    return cachedLogoPng;
  } catch {
    cachedLogoPng = null;
    return null;
  }
}
