import type { Candidate } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import type { RFCandidate } from "@/lib/recruiterflow";

// Row shape used by the /candidates list table.
export type CandidateListRow = {
  id: string;
  name: string;
  title: string;
  employer: string;
  location: string;
  updatedAt: string | null;
};

function composeName(first: string | null | undefined, last: string | null | undefined): string {
  const parts = [first, last].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : "(unnamed)";
}

// List candidates for the signed-in tenant. `query` does a case-insensitive
// substring match across the name/email/title/employer/location columns —
// matches the RF search semantics the previous /candidates page relied on.
export async function getCandidatesForOrg(params: { query?: string } = {}): Promise<CandidateListRow[]> {
  const org = await getCurrentOrg();
  const q = params.query?.trim() ?? "";
  const where: Prisma.CandidateWhereInput = { organizationId: org.id };
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { currentDesignation: { contains: q, mode: "insensitive" } },
      { currentOrganization: { contains: q, mode: "insensitive" } },
      { location: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.candidate.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: composeName(r.firstName, r.lastName),
    title: r.currentDesignation ?? "",
    employer: r.currentOrganization ?? "",
    location: r.location ?? "",
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// Resolves a `/candidates/[id]` URL segment to a Candidate row. Accepts
// either a cuid (Ace-native, Phase 1 canonical form) or a numeric RF id
// string (legacy URLs from before the cutover). Scoped by the caller's
// organization so cross-tenant lookups return null.
export async function getCandidateByIdentifier(raw: string): Promise<Candidate | null> {
  const org = await getCurrentOrg();
  if (/^\d+$/.test(raw)) {
    const rfId = Number(raw);
    if (!Number.isFinite(rfId)) return null;
    return prisma.candidate.findFirst({ where: { rfId, organizationId: org.id } });
  }
  return prisma.candidate.findFirst({ where: { id: raw, organizationId: org.id } });
}

// Returns every imported RF candidate for the tenant in the RF-shaped
// payload that the Jobs/Applicants/Pipeline/Dashboard/Clients pages still
// consume. Source is Neon — Candidate.raw holds the RF payload captured
// during the Phase 0 import (+ the Phase 1 backfill), so downstream code
// that iterates `c.jobs[]`, `c.tags`, `c.attributes`, etc. keeps working
// without an ongoing RecruiterFlow dependency.
//
// Ace-native candidates (rfId == null) are excluded because callers expect
// the RF numeric id in `c.id`; they show up on /candidates but not on the
// pipeline-count rollups until Phase 2 moves Jobs to Neon.
export async function getRfCandidatesForOrg(): Promise<RFCandidate[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.candidate.findMany({
    where: { organizationId: org.id, rfId: { not: null } },
    select: { rfId: true, raw: true },
  });
  const out: RFCandidate[] = [];
  for (const r of rows) {
    if (r.rfId == null) continue;
    const raw = r.raw as RFCandidate | null;
    if (raw && typeof raw === "object") {
      // Guard against stale raw.id values: canonicalize to rfId.
      out.push({ ...raw, id: r.rfId });
    }
  }
  return out;
}

// Fetches a single RF-shaped candidate payload from Neon by RF id. Used by
// merge-field resolution and any other code that used to call
// recruiterflow.getCandidate(). Returns null if the candidate isn't in the
// caller's tenant or was never imported.
export async function getRfCandidateByRfId(rfId: number): Promise<RFCandidate | null> {
  const org = await getCurrentOrg();
  const row = await prisma.candidate.findFirst({
    where: { rfId, organizationId: org.id },
    select: { rfId: true, raw: true, firstName: true, lastName: true, email: true, phone: true, currentDesignation: true, currentOrganization: true, location: true, linkedinProfile: true, skills: true },
  });
  if (!row) return null;
  const raw = row.raw as RFCandidate | null;
  if (raw && typeof raw === "object") {
    return { ...raw, id: row.rfId ?? raw.id };
  }
  // Fallback shape from structured columns (Ace-native candidates with an
  // rfId linked via email collision in Phase 0). Limited detail because
  // those rows never carried an RF payload.
  return {
    id: row.rfId!,
    first_name: row.firstName,
    last_name: row.lastName ?? undefined,
    email: row.email ?? undefined,
    phone_number: row.phone ?? undefined,
    current_designation: row.currentDesignation ?? undefined,
    current_organization: row.currentOrganization ?? undefined,
    location: row.location ? { city: row.location } : null,
    linkedin_profile: row.linkedinProfile ?? undefined,
    skills: row.skills,
  };
}
