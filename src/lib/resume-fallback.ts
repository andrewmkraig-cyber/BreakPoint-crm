// Best-effort parsing when Claude is unavailable. Uses pdf-parse for text and
// regexes for email / phone. Everything here is conservative — we'd rather
// leave a field blank than populate it with garbage.
import type { ParsedCandidate } from "@/lib/claude";
import { fetchLinkedInProfileMetadata } from "@/lib/linkedin-profile-metadata";
import { normalizeCandidateNameForMatching } from "@/lib/resume-filename";
import { extractDocxText, looksLikeDocx } from "@/lib/resume-text";
import { normalizeToE164 } from "@/lib/rf-payload-shapes";

const EMPTY: ParsedCandidate = {
  first_name: null,
  last_name: null,
  email: null,
  phone: null,
  current_designation: null,
  current_organization: null,
  location: null,
  zip: null,
  linkedin_profile: null,
  skills: [],
  notes: null,
  experience: [],
  education: [],
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
    } else if (looksLikeDocx(resume.filename, resume.mimeType)) {
      text = await extractDocxText(resume.data);
    } else if (resume.mimeType.startsWith("text/")) {
      text = resume.data.toString("utf-8");
    }
  }
  if (pastedText) text += `\n${pastedText}`;

  const result: ParsedCandidate = { ...EMPTY };

  // Name - prefer the resume/header text, then fall back to the filename.
  const parsedName = nameFromText(text) ?? (resume ? nameFromFilename(resume.filename) : null);
  if (parsedName) {
    result.first_name = parsedName.first;
    result.last_name = parsedName.last;
  }

  // Email / phone via regex.
  const email = findEmail(text);
  if (email) result.email = email;

  const phone = findPhone(text);
  if (phone) result.phone = normalizeToE164(phone);

  const zip = findZip(text);
  if (zip) result.zip = zip;

  const location = findLocation(text);
  if (location) result.location = location;

  // LinkedIn URL explicit input or match in text.
  const linkedIn = linkedinUrl || findLinkedIn(text);
  if (linkedIn) result.linkedin_profile = linkedIn;

  const linkedInMetadata = linkedIn ? await fetchLinkedInProfileMetadata(linkedIn) : null;
  if (linkedInMetadata) {
    result.first_name = result.first_name ?? linkedInMetadata.firstName;
    result.last_name = result.last_name ?? linkedInMetadata.lastName;
    result.current_organization = result.current_organization ?? linkedInMetadata.currentOrganization;
    result.location = result.location ?? linkedInMetadata.location;
    result.skills = mergeSkillLists(result.skills, linkedInMetadata.skills).slice(0, 10);
  }

  // Stash extracted text as notes so the user can see what we pulled.
  if (text.trim()) {
    const preview = text.trim().slice(0, 2000);
    result.notes = `Auto-extracted from resume (Claude unavailable). Review before saving.\n\n${preview}`;
  } else if (linkedInMetadata?.summary) {
    result.notes = `Public LinkedIn metadata: ${linkedInMetadata.summary}.`;
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
  const normalized = normalizeCandidateNameForMatching(filename);
  if (!normalized) return null;
  const cleaned = normalized.split(" ").filter(Boolean);
  if (cleaned.length === 1) return { first: cleaned[0], last: null };
  return { first: cleaned[0], last: cleaned.slice(1).join(" ") };
}

function nameFromText(text: string): { first: string; last: string | null } | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const line of lines) {
    if (findEmail(line) || findPhone(line) || /linkedin\.com/i.test(line)) continue;
    const beforeCredential = line.split(",")[0] ?? "";
    const candidate = beforeCredential
      .replace(/[^A-Za-z .'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!candidate || candidate.length > 80) continue;
    if (/\b(resume|curriculum|professional|specialist|manager|director|engineer|accountant|summary)\b/i.test(candidate)) {
      continue;
    }
    const parts = candidate.split(" ").filter(Boolean);
    if (parts.length < 2 || parts.length > 4) continue;
    const cleaned = parts.map(titleCaseNameToken);
    return { first: cleaned[0], last: cleaned.slice(1).join(" ") };
  }

  return null;
}

function titleCaseNameToken(token: string): string {
  return token
    .split(/([-'])/)
    .map((part) => {
      if (part === "-" || part === "'") return part;
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
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

function findZip(text: string): string | null {
  const labeled = text.match(/\b(?:zip|postal(?:\s+code)?)\D{0,12}(\d{5})(?:-\d{4})?\b/i);
  if (labeled) return labeled[1];

  const stateZip = text.match(/\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/);
  return stateZip?.[1] ?? null;
}

function findLocation(text: string): string | null {
  const cityStateZip = text.match(/\b([A-Z][A-Za-z .'-]{1,48}),\s*([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?\b/);
  if (!cityStateZip) return null;
  const city = cityStateZip[1].replace(/\s+/g, " ").trim();
  const state = cityStateZip[2];
  const zip = cityStateZip[3];
  if (!city || /\b(email|phone|linkedin|resume)\b/i.test(city)) return null;
  return zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`;
}

function findLinkedIn(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:[a-z]+\.)?linkedin\.com\/in\/[A-Za-z0-9_\-%]+\/?/i);
  if (!m) return null;
  return /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
}

function mergeSkillLists(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const skill = raw.trim();
      if (!skill) continue;
      const key = skill.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(skill);
    }
  }
  return out;
}
