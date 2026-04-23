// Orchestrator — sniffs the input resume's format and dispatches to the
// correct redactor. Returns both the branded bytes and a report the caller
// can persist or surface to the reviewer.
import { redactPdf, type RedactionReport } from "./redact-pdf";
import { redactDocx, type RedactDocxReport } from "./redact-docx";

export type BrandResumeInput = {
  data: Uint8Array;
  mimeType: string;
  filename: string;
  candidateName?: string | null;
};

export type BrandResumeOutput = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  report:
    | { kind: "pdf"; detail: RedactionReport }
    | { kind: "docx"; detail: RedactDocxReport };
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function brandResume(input: BrandResumeInput): Promise<BrandResumeOutput> {
  const format = sniffFormat(input);
  if (format === "pdf") {
    const { bytes, report } = await redactPdf(input.data, {
      candidateName: input.candidateName,
    });
    return {
      bytes,
      mimeType: "application/pdf",
      filename: brandedFilename(input.filename, "pdf"),
      report: { kind: "pdf", detail: report },
    };
  }
  if (format === "docx") {
    const { bytes, report } = await redactDocx(input.data, {
      candidateName: input.candidateName,
    });
    return {
      bytes,
      mimeType: DOCX_MIME,
      filename: brandedFilename(input.filename, "docx"),
      report: { kind: "docx", detail: report },
    };
  }
  throw new BrandResumeUnsupportedError(
    `Unsupported resume format: ${input.mimeType || "unknown"} (${input.filename}). Branding is available for PDF and .docx only.`,
  );
}

export class BrandResumeUnsupportedError extends Error {
  readonly kind = "unsupported" as const;
}

function sniffFormat(input: BrandResumeInput): "pdf" | "docx" | "unknown" {
  const mime = input.mimeType.toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === DOCX_MIME) return "docx";
  // Fall back to extension sniff — some uploads store "application/octet-stream".
  const lower = input.filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  // Magic-byte sniff as last resort: PDF is "%PDF-", docx is a ZIP ("PK").
  if (input.data.length >= 4) {
    const b0 = input.data[0];
    const b1 = input.data[1];
    const b2 = input.data[2];
    const b3 = input.data[3];
    if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return "pdf";
    if (b0 === 0x50 && b1 === 0x4b) return "docx";
  }
  return "unknown";
}

function brandedFilename(original: string, ext: "pdf" | "docx"): string {
  const stem = original.replace(/\.(pdf|docx|doc)$/i, "").replace(/[\\\/:*?"<>|]/g, "_");
  const base = stem.length > 0 ? stem : "resume";
  return `${base} - BreakPoint Talent.${ext}`;
}
