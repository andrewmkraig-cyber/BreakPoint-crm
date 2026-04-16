// Best-effort parsing when Claude is unavailable. Uses pdf-parse for text and
// regexes for email / phone. Everything here is conservative — we'd rather
// leave a field blank than populate it with garbage.
import type { ParsedCandidate } from "@/lib/claude";
import { normalizeToE164 } from "@/lib/recruiterflow";

const EMPTY: ParsedCandidate = {
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  current_designation: null,
  current_organization: null,
  location: null,
  linkedin_profile: null,
  skills: [],
  notes: null,
};

export async function fallbackParseCandidate(params: {
  resume?: { filename: string; mimeType: string; data: Buffer };
  pastedText?: string;
  linkedinUrl?: string;
}): Promise<ParsedCandidate> {
  const { resume, pastedText, linkedinUrl } = params;

  let text = "";
  if (resume) {
    if (resume.mimeType === "application/pdf") {
      text = await extractPdfText(resume.data);
    } else if (resume.mimeType.startsWith("text/")) {
      text = resume.data.toString("utf-8");
    }
  }
  if (pastedText) text += `\n${pastedText}`;

  const result: ParsedCandidate = { ...EMPTY };

  // Name — try pasted text first, then filename.
  const nameFromFile = resume ? nameFromFilename(resume.filename) : null;
  if (nameFromFile) {
    result.first_name = nameFromFile.first;
    result.last_name = nameFromFile.last;
  }

  // Email / phone via regex.
  const email = findEmail(text);
  if (email) result.email = email;

  const phone = findPhone(text);
  if (phone) result.phone = normalizeToE164(phone);

  // LinkedIn URL explicit input or match in text.
  const linkedIn = linkedinUrl || findLinkedIn(text);
  if (linkedIn) result.linkedin_profile = linkedIn;

  // Stash extracted text as notes so the user can see what we pulled.
  if (text.trim()) {
    const preview = text.trim().slice(0, 2000);
    result.notes = `Auto-extracted from resume (Claude unavailable). Review before saving.\n\n${preview}`;
  } else if (linkedinUrl && !resume) {
    result.notes = "LinkedIn URL saved. Paste profile text and re-parse when Claude is back online.";
  }

  return result;
}

async function extractPdfText(data: Buffer): Promise<string> {
  try {
    const mod = (await import("pdf-parse")) as unknown as
      | { default: (buf: Buffer) => Promise<{ text: string }> }
      | ((buf: Buffer) => Promise<{ text: string }>);
    const parse = typeof mod === "function" ? mod : mod.default;
    const out = await parse(data);
    return (out.text ?? "").slice(0, 50_000);
  } catch {
    // Last-resort: scan raw buffer as utf-8. Works for PDFs with uncompressed
    // text streams (many plain resume templates).
    return data.toString("utf-8").replace(/[\x00-\x08\x0E-\x1F]/g, " ").slice(0, 50_000);
  }
}

function nameFromFilename(filename: string): { first: string; last: string | null } | null {
  const bare = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\b(resume|cv|curriculum vitae|profile|applicant|candidate|final|v\d+|\d{4,})\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!bare) return null;
  const parts = bare.split(" ").filter(Boolean);
  if (parts.length === 0) return null;
  // Title-case each part. Skip if all caps or extremely short garbage.
  const cleaned = parts.map(titleCase);
  if (cleaned.length === 1) return { first: cleaned[0], last: null };
  return { first: cleaned[0], last: cleaned.slice(1).join(" ") };
}

function titleCase(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function findEmail(text: string): string | null {
  const m = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : null;
}

function findPhone(text: string): string | null {
  // Looks for common US phone shapes — (216) 555-1234, 216.555.1234, +1 216 555 1234.
  const patterns: RegExp[] = [
    /\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
    /\(\d{3}\)\s*\d{3}[\s.-]?\d{4}/,
    /\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

function findLinkedIn(text: string): string | null {
  const m = text.match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%]+\/?/i);
  return m ? m[0] : null;
}
