"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseCandidateFields, type ParsedCandidate } from "@/lib/claude";
import { fallbackParseCandidate } from "@/lib/resume-fallback";
import { recruiterflow } from "@/lib/recruiterflow";

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return Boolean(session?.user?.email);
}

const MAX_RESUME_BYTES = 15 * 1024 * 1024;

export type ParseSource = "claude" | "fallback";

export type ParseResumeResult = Result<{
  parsed: ParsedCandidate;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number;
  source: ParseSource;
  claudeError: string | null;
}>;

export async function parseCandidate(formData: FormData): Promise<ParseResumeResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };

  const file = formData.get("resume");
  const pastedText = String(formData.get("pastedText") ?? "").trim();
  const linkedinUrl = String(formData.get("linkedinUrl") ?? "").trim();

  let resume: { filename: string; mimeType: string; data: Buffer } | undefined;
  let filename: string | null = null;
  let mimeType: string | null = null;
  let sizeBytes = 0;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_RESUME_BYTES) {
      return { ok: false, error: `Resume is too large (max ${MAX_RESUME_BYTES / (1024 * 1024)}MB).` };
    }
    resume = {
      filename: file.name,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    };
    filename = file.name;
    mimeType = file.type;
    sizeBytes = file.size;
  }

  if (!resume && !pastedText && !linkedinUrl) {
    return { ok: false, error: "Upload a resume, paste profile text, or enter a LinkedIn URL first." };
  }

  // Try Claude first — best-in-class extraction. On any failure (credit error,
  // rate limit, network), fall back to local text extraction so the user still
  // gets something to work with.
  try {
    const parsed = await parseCandidateFields({ resume, pastedText, linkedinUrl });
    return {
      ok: true,
      value: { parsed, filename, mimeType, sizeBytes, source: "claude", claudeError: null },
    };
  } catch (claudeErr) {
    const claudeError = claudeErr instanceof Error ? claudeErr.message : "Claude parsing failed.";
    try {
      const parsed = await fallbackParseCandidate({ resume, pastedText, linkedinUrl });
      return {
        ok: true,
        value: { parsed, filename, mimeType, sizeBytes, source: "fallback", claudeError },
      };
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : "Fallback parse failed.";
      return { ok: false, error: `Claude: ${claudeError}. Fallback: ${fallbackMsg}` };
    }
  }
}

export type CreateCandidatePayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  current_designation: string;
  current_organization: string;
  location: string;
  linkedin_profile: string;
  skills: string[];
  notes: string;
};

export type CreateCandidateResult = Result<{ id: number }>;

export async function createCandidate(payload: CreateCandidatePayload): Promise<CreateCandidateResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };

  const first = payload.first_name.trim();
  if (!first) return { ok: false, error: "First name is required." };

  try {
    const created = await recruiterflow.createCandidate({
      first_name: first,
      last_name: payload.last_name.trim() || undefined,
      email: payload.email.trim() || undefined,
      phone_number: payload.phone.trim() || undefined,
      current_designation: payload.current_designation.trim() || undefined,
      current_organization: payload.current_organization.trim() || undefined,
      location: payload.location.trim() || undefined,
      linkedin_profile: payload.linkedin_profile.trim() || undefined,
      skills: payload.skills.filter(Boolean),
      notes: payload.notes.trim() || undefined,
      source_name: "Ace",
    });
    revalidatePath("/candidates");
    return { ok: true, value: { id: created.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create candidate in RecruiterFlow." };
  }
}
