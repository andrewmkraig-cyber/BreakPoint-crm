"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

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
  current_designation?: string;
  current_organization?: string;
  linkedin_profile?: string;
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

async function resolveCandidate(rawId: number | string) {
  const org = await getCurrentOrg();
  if (typeof rawId === "number") {
    return prisma.candidate.findFirst({
      where: { rfId: rawId, organizationId: org.id },
      select: { id: true, rfId: true, raw: true },
    });
  }
  if (/^\d+$/.test(rawId)) {
    return prisma.candidate.findFirst({
      where: { rfId: Number(rawId), organizationId: org.id },
      select: { id: true, rfId: true, raw: true },
    });
  }
  return prisma.candidate.findFirst({
    where: { id: rawId, organizationId: org.id },
    select: { id: true, rfId: true, raw: true },
  });
}

export async function updateCandidate(patch: CandidatePatch): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (patch.id == null) return { ok: false, error: "Missing candidate id." };

  try {
    const candidate = await resolveCandidate(patch.id);
    if (!candidate) return { ok: false, error: "Candidate not found." };

    // Build the Neon-column update. Only fields actually present in the
    // patch are written so omitted fields keep their prior value.
    const data: Prisma.CandidateUpdateInput = {};
    if (patch.first_name !== undefined) data.firstName = patch.first_name;
    if (patch.last_name !== undefined) data.lastName = patch.last_name ?? null;
    if (patch.email !== undefined) data.email = pickFirstString(patch.email);
    if (patch.phone_number !== undefined) data.phone = pickFirstString(patch.phone_number);
    if (patch.current_designation !== undefined)
      data.currentDesignation = patch.current_designation ?? null;
    if (patch.current_organization !== undefined)
      data.currentOrganization = patch.current_organization ?? null;
    if (patch.linkedin_profile !== undefined)
      data.linkedinProfile = patch.linkedin_profile ?? null;
    if (patch.location !== undefined) data.location = locationToString(patch.location);
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

    await prisma.candidate.update({ where: { id: candidate.id }, data });

    // Revalidate both URL shapes so cached renders refresh.
    revalidatePath(`/candidates/${candidate.id}`);
    if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update candidate." };
  }
}

export async function deleteCandidateResume(candidateIdOrRfId: number | string): Promise<ActionResult> {
  if (!(await requireSession())) return { ok: false, error: "Not signed in." };
  if (candidateIdOrRfId == null) return { ok: false, error: "Missing candidate id." };

  try {
    const candidate = await resolveCandidate(candidateIdOrRfId);
    if (!candidate) return { ok: false, error: "Candidate not found." };

    await prisma.candidateResume.deleteMany({ where: { candidateId: candidate.id } });
    revalidatePath(`/candidates/${candidate.id}`);
    if (candidate.rfId != null) revalidatePath(`/candidates/${candidate.rfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete resume." };
  }
}
