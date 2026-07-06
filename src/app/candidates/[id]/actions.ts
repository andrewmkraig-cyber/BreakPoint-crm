"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { linkedinUrlFrom, normalizeToE164 } from "@/lib/rf-payload-shapes";

import { del } from "@vercel/blob";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { coordinatePatchForCandidateLocationUpdate } from "@/lib/candidate-location-geocode";
import { prisma } from "@/lib/prisma";
import { getResumeBytes } from "@/lib/resume-bytes";

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const s = await getServerSession(authOptions);
  return Boolean(s?.user?.email);
}

// The Editable* components and other call sites build patches in RF's
// snake_case / legacy shape so they stay stable through the Phase 1 read
// cutover. updateCandidate accepts that shape, translates to Neon fields,
// and merges both into top-level columns AND into Candidate.raw so the
// profile renderer (which reads from `raw`) stays consistent with the
// edit.
//
// `patch.id` can be either the legacy numeric RF id (for RF-imported
// candidates) or a cuid (Ace-native or post-cutover). Both are resolved
// via the tenant-scoped candidate lookup.
export type CandidatePatch = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  email?: string | string[];
  phone_number?: string | string[];
  // Additional (non-primary) contact info. The primary email/phone stays on
  // the email/phone columns above; these hold the extra rows from a
  // multi-row identity edit. Not uniqueness-checked.
  alt_emails?: string[];
  alt_phones?: string[];
  current_designation?: string;
  current_organization?: string;
  linkedin_profile?: string;
  source?: string | null;
  candidate_summary?: string;
  location?: { location?: string; city?: string; state?: string; country?: string } | string;
  expected_salary?: { number?: number | null; currency?: string | null } | null;
  skills?: string[];
  notes?: Array<{ id?: number; note: string; added_time?: string; added_by?: { name?: string } | null }>;
  experience?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
  tags?: string[];
};

function pickFirstString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object") {
        const n = (v as { number?: unknown }).number;
        if (typeof n === "string" && n.trim()) return n.trim();
      }
    }
  }
  return null;
}

function locationToString(
  value: CandidatePatch["location"],
): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object") {
    const parts = [value.city, value.state, value.country].filter(Boolean);
    if (parts.length) return parts.join(", ");
    return typeof value.location === "string" ? value.location.trim() || null : null;
  }
  return null;
}

function rfNotesToText(notes: CandidatePatch["notes"]): string | null {
  if (!Array.isArray(notes)) return null;
  const chunks = notes.map((n) => n.note?.trim()).filter((s): s is string => Boolean(s));
  return chunks.length ? chunks.join("\n\n---\n\n") : null;
}

async function resolveCandidate(rawId: number | string, organizationId: string) {
  if (typeof rawId === "number") {
    return prisma.candidate.findFirst({
      where: { rfId: rawId, organizationId },
      select: { id: true, rfId: true, raw: true, location: true, lat: true, lng: true },
    });
  }
  if (/^\d+$/.test(rawId)) {
    return prisma.candidate.findFirst({
      where: { rfId: Number(rawId), organizationId },
      select: { id: true, rfId: true, raw: true, location: true, lat: true, lng: true },
    });
  }
  return prisma.candidate.findFirst({
    where: { id: rawId, organizationId },
    select: { id: true, rfId: true, raw: true, location: true, lat: true, lng: true },
  });
}

export async function updateCandidate(patch: CandidatePatch): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (patch.id == null) return { ok: false, error: "Missing candidate id." };

  try {
    const org = await getCurrentOrg();
    const candidate = await resolveCandidate(patch.id, org.id);
    if (!candidate) return { ok: false, error: "Candidate not found." };

    // Build the Neon-column update. Only fields actually present in the
    // patch are written so omitted fields keep their prior value.
    const data: Prisma.CandidateUpdateInput = {};
    if (patch.first_name !== undefined) data.firstName = patch.first_name;
    if (patch.last_name !== undefined) data.lastName = patch.last_name ?? null;
    if (patch.email !== undefined) data.email = pickFirstString(patch.email);
    if (patch.phone_number !== undefined) data.phone = normalizeToE164(pickFirstString(patch.phone_number));
    if (patch.alt_emails !== undefined)
      data.altEmails = patch.alt_emails.map((e) => e.trim()).filter(Boolean);
    if (patch.alt_phones !== undefined)
      data.altPhones = patch.alt_phones
        .map((p) => normalizeToE164(p) ?? "")
        .filter(Boolean);
    if (patch.current_designation !== undefined)
      data.currentDesignation = patch.current_designation ?? null;
    if (patch.current_organization !== undefined)
      data.currentOrganization = patch.current_organization ?? null;
    if (patch.linkedin_profile !== undefined)
      data.linkedinProfile = linkedinUrlFrom(patch.linkedin_profile) || null;
    if (patch.source !== undefined) data.source = patch.source?.trim() || null;
    if (patch.location !== undefined) {
      const nextLocation = locationToString(patch.location);
      data.location = nextLocation;
      Object.assign(
        data,
        await coordinatePatchForCandidateLocationUpdate({
          nextLocation,
          previousLocation: candidate.location,
          previousLat: candidate.lat,
          previousLng: candidate.lng,
        }),
      );
    }
    if (patch.skills !== undefined) data.skills = patch.skills ?? [];
    if (patch.tags !== undefined) data.tags = patch.tags ?? [];
    if (patch.expected_salary !== undefined) {
      data.expectedSalary = (patch.expected_salary ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (patch.experience !== undefined) {
      data.experience = (patch.experience ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (patch.education !== undefined) {
      data.education = (patch.education ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (patch.notes !== undefined) {
      data.notes = rfNotesToText(patch.notes);
    }

    // Also merge the patch into Candidate.raw so the profile's RF-shaped
    // display (which reads from raw) reflects the edit immediately.
    const prevRaw = (candidate.raw as Record<string, unknown> | null) ?? {};
    const nextRaw: Record<string, unknown> = { ...prevRaw };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "id") continue;
      nextRaw[key] = value;
    }
    data.raw = nextRaw as Prisma.InputJsonValue;

    await prisma.candidate.update({ where: { id: candidate.id, organizationId: org.id }, data });

    // Revalidate both URL shapes so cached renders refresh.
    revalidatePath(`/candidates/${candidate.id}`);
    if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update candidate." };
  }
}

// Ace 28.0: hard-delete a candidate and every row that references it.
// Cascades follow the explicit list documented in the prompt rather
// than leaning on Prisma's onDelete: Cascade alone — three of the
// related tables (SmsMessage, CallLog, ActivityLog) carry a candidateId
// without a foreign-key relation, and CallTranscript points at CallLog
// without an onDelete clause, so an unscoped Candidate.delete would
// orphan rows. Wrapping the whole sequence in $transaction keeps it
// atomic: any failure rolls back the entire delete.
//
// Tenant scope (Architecture rule #8): the candidate is resolved via
// the org-scoped lookup before any delete fires. A forged id from
// another tenant returns "Candidate not found." with no rows touched.
export async function deleteCandidate(id: string): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (!id) return { ok: false, error: "Missing candidate id." };

  try {
    const org = await getCurrentOrg();
    const candidate = await prisma.candidate.findFirst({
      where: { id, organizationId: org.id },
      select: { id: true, rfId: true, organizationId: true },
    });
    if (!candidate) return { ok: false, error: "Candidate not found." };

    await prisma.$transaction(async (tx) => {
      // CallTranscript first — its FK to CallLog has no onDelete cascade
      // so the rows must come out before their parent CallLog rows.
      const callLogIds = await tx.callLog.findMany({
        where: { candidateId: candidate.id },
        select: { id: true },
      });
      if (callLogIds.length > 0) {
        await tx.callTranscript.deleteMany({
          where: { callLogId: { in: callLogIds.map((r) => r.id) } },
        });
      }
      await tx.callLog.deleteMany({ where: { candidateId: candidate.id } });
      await tx.smsMessage.deleteMany({ where: { candidateId: candidate.id } });
      await tx.activityLog.deleteMany({
        where: { targetType: "candidate", targetId: candidate.id },
      });
      await tx.candidateResume.deleteMany({ where: { candidateId: candidate.id } });
      await tx.placement.deleteMany({ where: { candidateId: candidate.id } });
      await tx.interview.deleteMany({ where: { candidateId: candidate.id } });
      await tx.candidateListMembership.deleteMany({ where: { candidateId: candidate.id } });
      await tx.gmailThreadTag.deleteMany({ where: { candidateId: candidate.id } });
      await tx.candidate.delete({ where: { id: candidate.id } });
    });

    revalidatePath("/candidates");
    revalidatePath(`/candidates/${candidate.id}`);
    if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete candidate." };
  }
}

// Phase 5A.5.b (Ace 20.0): per-version delete. Earlier versions of this
// action took a candidateId/rfId and wiped EVERY CandidateResume row
// for that candidate — fine when there was only one row per candidate,
// disastrous after 5A.5.a let recruiters hold multiple versions. The
// signature now takes a specific row's resumeId, scoped by org.
//
// Implementation note: deleteMany is used so the action is idempotent
// against transient races (e.g. a stale tab firing after the row was
// already removed) and so a tenant-scope mismatch returns a clean
// "not found" error rather than a thrown Prisma exception.
export async function deleteCandidateResume(resumeId: string): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (!resumeId) return { ok: false, error: "Missing resume id." };

  try {
    const org = await getCurrentOrg();
    const target = await prisma.candidateResume.findFirst({
      where: { id: resumeId, organizationId: org.id },
      select: {
        candidateId: true,
        candidateRfId: true,
        blobUrl: true,
        redactedBlobUrl: true,
      },
    });
    // Best-effort blob cleanup before the DB row goes — a missing or
    // already-deleted blob must not block the DB delete, so each call
    // is wrapped in its own try/catch.
    if (target?.blobUrl) {
      try {
        await del(target.blobUrl);
      } catch {
        // ignore — DB delete still proceeds
      }
    }
    if (target?.redactedBlobUrl) {
      try {
        await del(target.redactedBlobUrl);
      } catch {
        // ignore — DB delete still proceeds
      }
    }
    const result = await prisma.candidateResume.deleteMany({
      where: { id: resumeId, organizationId: org.id },
    });
    if (result.count === 0) {
      return { ok: false, error: "Resume version not found." };
    }

    // When the deleted row was the candidate's LAST CandidateResume row,
    // null out the legacy inline Candidate.resume* columns. Otherwise
    // the lazy-backfill in local-profile.tsx (which mirrors the inline
    // columns into a fresh CandidateResume row whenever it sees zero
    // rows) immediately resurrects the resume on the next page load.
    // The inline columns were the source-of-truth before 5A.5.a; the
    // backfill is the only remaining reader, so nulling them is safe.
    if (target?.candidateId) {
      const remaining = await prisma.candidateResume.count({
        where: { candidateId: target.candidateId },
      });
      if (remaining === 0) {
        await prisma.candidate.update({
          where: { id: target.candidateId },
          data: {
            resumeFilename: null,
            resumeMimeType: null,
            resumeSize: null,
            resumeData: null,
            resumeUploadedAt: null,
          },
        });
      }
      revalidatePath(`/candidates/${target.candidateId}`);
    }
    if (target?.candidateRfId != null && target.candidateRfId > 0) {
      revalidatePath(`/candidates/${target.candidateRfId}`);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete resume." };
  }
}

// Phase 5A.5.b (Ace 20.0): convert a DOCX CandidateResume row into a
// new PDF row and save it as variant="converted" so the Edit Resume
// editor + branded export both receive a faithful PDF.
//
// Conversion order:
//   1. CloudConvert HTTPS API (CLOUDCONVERT_API_KEY env) - faithful,
//      formatting-preserving. Preferred when the key is set.
//   2. mammoth.extractRawText + pdf-lib reflow - plain text fallback
//      used when the key is absent or CloudConvert returns an error.
//
// Tenant scope: source row + write target both filter by org via
// getCurrentOrg(). A forged resumeId from another tenant errors out.
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LEGACY_DOC_MIME = "application/msword";

// Reflow fallback: extract raw text via mammoth and lay it onto a
// Letter-size PDF with pdf-lib. No formatting carry-over; used only
// when CloudConvert is unavailable.
async function docxToPlainTextPdf(sourceBuffer: Buffer): Promise<Uint8Array> {
  const mammoth = await import("mammoth");
  const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
  if (!extract) throw new Error("DOCX extractor unavailable.");
  const { value: rawText } = await extract({ buffer: sourceBuffer });
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
    // pdf-lib chokes on characters outside WinAnsi; replace anything
    // the standard font can't measure with a placeholder so a stray
    // emoji or smart-quote doesn't 500 the whole conversion.
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

  const paragraphs = text.split(/\n+/);
  for (const paragraph of paragraphs) {
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

  return pdf.save();
}

export async function convertDocxResumeToPdf(input: {
  resumeId: string;
}): Promise<ActionResult<{ resumeId: string }>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { ok: false, error: "Not signed in." };
  if (!input.resumeId) return { ok: false, error: "Missing resume id." };

  try {
    const org = await getCurrentOrg();
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "Not signed in." };

    const source = await prisma.candidateResume.findFirst({
      where: { id: input.resumeId, organizationId: org.id },
    });
    if (!source) return { ok: false, error: "Source resume not found." };
    if (source.mimeType !== DOCX_MIME && source.mimeType !== LEGACY_DOC_MIME) {
      return { ok: false, error: "Convert is only available for .doc / .docx resumes." };
    }

    const sourceBuffer = await getResumeBytes(source);

    // Try CloudConvert for a formatting-faithful PDF first.
    let outputBytes: Uint8Array | null = null;
    try {
      const { convertDocxToPdfViaCloudConvert } = await import(
        "@/lib/cloudconvert-docx-pdf"
      );
      const buf = await convertDocxToPdfViaCloudConvert(sourceBuffer, source.filename);
      if (buf) outputBytes = new Uint8Array(buf);
    } catch (err) {
      console.warn(
        "[convertDocxResumeToPdf] CloudConvert failed, falling back to reflow",
        err instanceof Error ? err.message : String(err),
      );
    }

    // Fallback: mammoth text reflow.
    if (!outputBytes) {
      outputBytes = await docxToPlainTextPdf(sourceBuffer);
    }

    const baseName =
      (source.displayName?.trim() || source.filename).replace(/\.(pdf|docx?|txt)$/i, "");
    const filename = `${baseName}.pdf`;

    const ab = new ArrayBuffer(outputBytes.byteLength);
    const data = new Uint8Array(ab);
    data.set(outputBytes);

    // Replace any previously saved converted rows for this candidate so stale
    // mammoth plain-text PDFs don't accumulate or get shown in the editor.
    if (source.candidateId) {
      await prisma.candidateResume.deleteMany({
        where: { organizationId: org.id, variant: "converted", candidateId: source.candidateId },
      });
    } else if (source.candidateRfId != null && source.candidateRfId > 0) {
      await prisma.candidateResume.deleteMany({
        where: { organizationId: org.id, variant: "converted", candidateRfId: source.candidateRfId },
      });
    }

    const created = await prisma.candidateResume.create({
      data: {
        candidateId: source.candidateId,
        candidateRfId: source.candidateRfId,
        organizationId: org.id,
        filename,
        mimeType: "application/pdf",
        size: data.byteLength,
        data,
        variant: "converted",
        uploadComplete: true,
        uploadedById: user.id,
      },
      select: { id: true },
    });

    if (source.candidateId) revalidatePath(`/candidates/${source.candidateId}`);
    if (source.candidateRfId != null && source.candidateRfId > 0) {
      revalidatePath(`/candidates/${source.candidateRfId}`);
    }
    return { ok: true, value: { resumeId: created.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to convert DOCX." };
  }
}

// Phase 5A.5.a: rename a specific CandidateResume version. Trims the
// input + falls back to clearing displayName when blank — the UI
// then renders the original upload filename. Scoped by organizationId
// so a forged resumeId from another tenant errors out cleanly.
export async function renameCandidateResume(input: {
  resumeId: string;
  displayName: string;
}): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (!input.resumeId) return { ok: false, error: "Missing resume id." };

  const trimmed = input.displayName.trim();
  // Strip any extension the user typed — we always serve as .pdf and
  // we don't want "Linda.pdf.pdf" surfacing in the download header.
  const stripped = trimmed.replace(/\.(pdf|docx?|txt)$/i, "");
  // 200 is generous for an email subject / display chip; clamp here
  // so a 5MB paste doesn't smuggle into a Bytes-adjacent column.
  if (stripped.length > 200) {
    return { ok: false, error: "Display name is too long (max 200)." };
  }

  try {
    const { getCurrentOrg } = await import("@/lib/auth/getCurrentOrg");
    const org = await getCurrentOrg();
    const existing = await prisma.candidateResume.findFirst({
      where: { id: input.resumeId, organizationId: org.id },
      select: { id: true, candidateId: true, candidateRfId: true },
    });
    if (!existing) return { ok: false, error: "Resume not found." };

    await prisma.candidateResume.update({
      where: { id: existing.id },
      data: { displayName: stripped.length > 0 ? stripped : null },
    });

    if (existing.candidateId) revalidatePath(`/candidates/${existing.candidateId}`);
    if (existing.candidateRfId != null && existing.candidateRfId > 0) revalidatePath(`/candidates/${existing.candidateRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to rename resume." };
  }
}

// Fallback for the search-result candidate profile: instead of tinting
// matched words inside the rasterized PDF (which surfaces line-granular
// pdfjs text runs that read as full-line blocks), we surface the
// matching lines from CandidateResume.extractedText so the recruiter
// gets keyword confirmation without painting over the resume.
//
// Tokens are matched with a word-boundary regex so "tax" hits inside
// "tax credit" but not inside "syntax". Result is capped at 5 lines.
// Each snippet carries the token set it matched so the UI can render
// per-token <mark> spans against the same text.
export type ResumeMatchSnippet = {
  text: string;
  matchedTokens: string[];
};

export type ResumeMatchesResult =
  | { ok: true; snippets: ResumeMatchSnippet[]; totalMatches: number; hasExtractedText: boolean }
  | { ok: false; error: string };

const RESUME_MATCH_CAP = 5;
const RESUME_MATCH_LINE_TRIM = 240;

function escapeRegexToken(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findResumeMatches(
  resumeId: string,
  rawTokens: string[],
): Promise<ResumeMatchesResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  const tokens = rawTokens.map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return { ok: true, snippets: [], totalMatches: 0, hasExtractedText: true };
  }
  try {
    const { id: organizationId } = await getCurrentOrg();
    const resume = await prisma.candidateResume.findFirst({
      where: { id: resumeId, organizationId },
      select: { extractedText: true },
    });
    if (!resume) return { ok: false, error: "Resume not found." };
    const text = resume.extractedText ?? "";
    if (!text.trim()) {
      return { ok: true, snippets: [], totalMatches: 0, hasExtractedText: false };
    }

    const probes = tokens.map((t) => ({
      token: t,
      // Two regexes per token: `single` for the per-line membership
      // test (fast early-exit), `global` for the `<mark>` segment
      // walk in the UI — exported by token so the client doesn't
      // have to reconstruct them.
      single: new RegExp(`\\b${escapeRegexToken(t)}\\b`, "i"),
    }));

    // Split on any newline. PDFs piped through pdf-parse / pdfjs into
    // CandidateResume.extractedText preserve line breaks; long lines
    // get trimmed at the snippet boundary.
    const lines = text.split(/\r?\n/);
    const seen = new Set<string>();
    const snippets: ResumeMatchSnippet[] = [];
    let totalMatches = 0;
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (line.length === 0) continue;
      const matched: string[] = [];
      for (const p of probes) {
        if (p.single.test(line)) matched.push(p.token);
      }
      if (matched.length === 0) continue;
      totalMatches += 1;
      if (snippets.length >= RESUME_MATCH_CAP) continue;
      const trimmed =
        line.length > RESUME_MATCH_LINE_TRIM
          ? line.slice(0, RESUME_MATCH_LINE_TRIM) + "…"
          : line;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      snippets.push({ text: trimmed, matchedTokens: matched });
    }

    return { ok: true, snippets, totalMatches, hasExtractedText: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to load resume matches." };
  }
}
