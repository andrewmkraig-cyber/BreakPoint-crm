// Server-side docx redactor + brand stamper.
//
// docx preserves no usable layout information in plain-text extraction, so
// we take a different approach than the PDF path:
//   1. Extract raw text (line-delimited) with mammoth.
//   2. Classify each non-empty line with the same PII regexes used for the
//      PDF path — drop pii lines, keep clean lines, log ambiguous ones.
//   3. Rebuild a clean .docx via the `docx` library, with a first-page
//      header containing the BreakPoint wordmark (right-aligned) and the
//      candidate's name at the top of the body.
//
// Output fidelity is lower than the PDF path (original formatting is lost)
// but the content + brand are preserved, which is the contract for client
// distribution.
import mammoth from "mammoth";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type RedactDocxReport = {
  linesKept: number;
  linesRedacted: number;
  unsureLines: string[];
  logoStamped: boolean;
};

export type RedactDocxResult = {
  bytes: Uint8Array;
  report: RedactDocxReport;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,2}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]+\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9_\-%]+\/?/i;
const PERSONAL_URL_RE = /(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9\-]+\.(?:me|io|dev|xyz|site|online|personal|tech)\b/i;
const STREET_ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z][A-Za-z\s\.]*\b(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Way|Court|Ct\.?|Place|Pl\.?|Parkway|Pkwy\.?)\b/i;
const CITY_STATE_ZIP_RE = /\b[A-Z][A-Za-z\-\.\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;

export async function redactDocx(
  input: Uint8Array,
  opts: { candidateName?: string | null } = {},
): Promise<RedactDocxResult> {
  const report: RedactDocxReport = {
    linesKept: 0,
    linesRedacted: 0,
    unsureLines: [],
    logoStamped: false,
  };

  const candidateName = (opts.candidateName ?? "").trim();
  const nameTokens = new Set(
    candidateName
      .split(/\s+/)
      .map((t) => t.replace(/[^A-Za-z'\-]/g, "").toLowerCase())
      .filter((t) => t.length >= 2),
  );

  // mammoth extractRawText returns a flat string with \n between paragraphs.
  const { value: rawText } = await mammoth.extractRawText({
    buffer: Buffer.from(input),
  });
  const lines = rawText.split(/\r?\n/);

  const kept: string[] = [];
  let seenName = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // Preserve blank lines as paragraph breaks — but only when we've
      // started capturing content, to avoid leading empties.
      if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (isNameLine(line, nameTokens)) {
      if (!seenName) {
        kept.push(line);
        seenName = true;
      }
      // Either way we don't count the name line as redacted.
      continue;
    }
    const cls = classifyLine(line);
    if (cls === "pii") {
      report.linesRedacted++;
      continue;
    }
    if (cls === "unsure") {
      report.unsureLines.push(line);
      kept.push(line);
      report.linesKept++;
      continue;
    }
    kept.push(line);
    report.linesKept++;
  }

  // If the name was never detected in the body, prepend it so the client
  // still knows whose resume this is.
  if (candidateName && !seenName) {
    kept.unshift("", candidateName);
  }

  const { header, logoStamped } = await buildFirstPageHeader();
  report.logoStamped = logoStamped;

  const paragraphs: Paragraph[] = kept.map((line, idx) => {
    if (line === "") return new Paragraph({ children: [new TextRun("")] });
    // Treat the candidate name (first non-empty line that matches) as a
    // title-style heading.
    if (idx === kept.findIndex((l) => l !== "") && candidateName && sameName(line, candidateName)) {
      return new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 160 },
        children: [
          new TextRun({ text: line, bold: true, size: 32, font: "Calibri" }),
        ],
      });
    }
    return new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: line, size: 22, font: "Calibri" })],
    });
  });

  const doc = new Document({
    creator: "BreakPoint Talent",
    title: candidateName ? `${candidateName} - BreakPoint Talent` : "Resume",
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            margin: { top: 1080, bottom: 720, left: 720, right: 720 },
          },
        },
        headers: {
          first: header,
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "Represented by BreakPoint Talent",
                    size: 16,
                    color: "5A9642",
                    font: "Calibri",
                  }),
                ],
              }),
            ],
          }),
        },
        children: paragraphs,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return { bytes, report };
}

function classifyLine(line: string): "pii" | "unsure" | "clean" {
  if (EMAIL_RE.test(line)) return "pii";
  if (PHONE_RE.test(line)) return "pii";
  if (LINKEDIN_RE.test(line)) return "pii";
  if (PERSONAL_URL_RE.test(line)) return "pii";
  if (STREET_ADDRESS_RE.test(line)) return "pii";
  if (CITY_STATE_ZIP_RE.test(line)) return "pii";
  if (/^(contact|personal|get in touch|reach me)\b/i.test(line) && line.length < 40) {
    return "unsure";
  }
  return "clean";
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
  return matched >= Math.min(2, nameTokens.size) || matched / tokens.length >= 0.6;
}

function sameName(line: string, name: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(line) === norm(name);
}

async function buildFirstPageHeader(): Promise<{ header: Header; logoStamped: boolean }> {
  const png = await loadLogoPng();
  if (png) {
    const header = new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new ImageRun({
              data: png,
              transformation: { width: 80, height: 26 },
              type: "png",
            }),
          ],
        }),
      ],
    });
    return { header, logoStamped: true };
  }
  // Vector wordmark fallback: a narrow right-aligned table cell with
  // navy background and the BreakPoint wordmark inside.
  const wordmarkRow = new TableRow({
    height: { value: 520, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        width: { size: 1800, type: WidthType.DXA },
        shading: { fill: "111111" },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 20 },
            children: [
              new TextRun({
                text: "BreakPoint",
                bold: true,
                color: "FFFFFF",
                size: 20,
                font: "Calibri",
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 60 },
            children: [
              new TextRun({
                text: "Talent",
                color: "5A9642",
                size: 14,
                font: "Calibri",
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const table = new Table({
    alignment: AlignmentType.RIGHT,
    width: { size: 1800, type: WidthType.DXA },
    rows: [wordmarkRow],
  });
  const header = new Header({ children: [table] });
  return { header, logoStamped: true };
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
