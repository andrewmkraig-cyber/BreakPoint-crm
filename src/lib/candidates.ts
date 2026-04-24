import type { Candidate } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import type { RFCandidate, RFClient, RFContact, RFJob } from "@/lib/rf-payload-shapes";

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

// ---- Jobs / Clients / Contacts RF-shaped shims (reads from Neon) ----
//
// Phase 0 imported the full RF payload for each of these into the
// Job.raw / Client.raw / Contact.raw columns. These shims return the
// stored RF-shaped data so pages that still consume RFJob[] / RFClient[]
// / RFContact[] can operate against Neon without a live RF call. The
// smoke tests in CI run against a ci-smoke Neon branch that can't reach
// RF — these shims make the profile / job / applicants pages work
// anyway. Production continues to work unchanged because Phase 0
// populated `raw` for every imported row.

// Phase 2: the shim now surfaces Ace-native Jobs (legacyRfId = null) too.
// Ace-native rows get a synthetic negative numeric `id` (djb2 hash of cuid,
// negated) so the RFJob.id field can remain a number without colliding with
// any real RF positive id. The cuid is carried alongside on `_aceJobId` so
// write paths (Placement / Interview creation) can set jobId (cuid FK) and
// leave jobRfId null. Same treatment for the companyId (→ _aceClientId).
export type RFJobWithAce = RFJob & {
  _aceJobId?: string;
  _aceClientId?: string;
};

// djb2 → 31-bit unsigned → negate so Ace-native synthetic ids land in
// (-2^31, -1] and can never collide with positive RF ids.
function syntheticIdFromCuid(cuid: string): number {
  let hash = 5381;
  for (let i = 0; i < cuid.length; i++) {
    hash = ((hash << 5) + hash + cuid.charCodeAt(i)) >>> 0;
  }
  return -((hash & 0x7fffffff) || 1);
}

export async function getRfJobsForOrg(): Promise<RFJobWithAce[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.job.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      legacyRfId: true,
      raw: true,
      title: true,
      isOpen: true,
      locations: true,
      description: true,
      clientId: true,
      client: { select: { id: true, legacyRfId: true, name: true } },
    },
  });
  const out: RFJobWithAce[] = [];
  for (const r of rows) {
    const raw = r.raw as RFJob | null;
    if (r.legacyRfId != null) {
      // RF-imported row: hand back the original payload keyed by its
      // legacyRfId so every existing indexer (jobs.find(j => j.id === rfId))
      // keeps working unchanged.
      if (raw && typeof raw === "object") {
        out.push({ ...raw, id: r.legacyRfId });
      } else {
        out.push({ id: r.legacyRfId, title: r.title, is_open: r.isOpen });
      }
      continue;
    }
    // Ace-native row. No RF payload — synthesize a minimal RFJob shape
    // from the Neon columns plus the cuid identity fields so write paths
    // can persist Placement.jobId correctly.
    const syntheticId = syntheticIdFromCuid(r.id);
    const companyRef = r.client
      ? {
          id: r.client.legacyRfId ?? syntheticIdFromCuid(r.client.id),
          name: r.client.name,
        }
      : null;
    out.push({
      id: syntheticId,
      title: r.title,
      is_open: r.isOpen,
      locations: Array.isArray(r.locations) ? r.locations : [],
      company: companyRef,
      description: r.description ?? undefined,
      _aceJobId: r.id,
      _aceClientId: r.client && r.client.legacyRfId == null ? r.client.id : undefined,
    });
  }
  return out;
}

export async function getRfClientsForOrg(): Promise<RFClient[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.client.findMany({
    where: { organizationId: org.id, legacyRfId: { not: null } },
    select: { legacyRfId: true, raw: true, name: true },
  });
  const out: RFClient[] = [];
  for (const r of rows) {
    if (r.legacyRfId == null) continue;
    const raw = r.raw as RFClient | null;
    if (raw && typeof raw === "object") {
      out.push({ ...raw, id: r.legacyRfId });
      continue;
    }
    out.push({ id: r.legacyRfId, name: r.name });
  }
  return out;
}

export async function getRfContactsForOrg(): Promise<RFContact[]> {
  const org = await getCurrentOrg();
  const rows = await prisma.contact.findMany({
    where: { organizationId: org.id, legacyRfId: { not: null } },
    select: { legacyRfId: true, raw: true, firstName: true, lastName: true, emails: true, clientId: true, currentDesignation: true },
  });
  // contactsByClientLegacyRfId needs the clientRfId on the contact (RF
  // id, not cuid). Look up the Client row once so we can populate
  // client_company_id on each contact payload even if `raw` is absent.
  const clientIdToLegacyRf = new Map<string, number>();
  if (rows.some((r) => r.clientId)) {
    const clientRows = await prisma.client.findMany({
      where: { id: { in: Array.from(new Set(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)))) } },
      select: { id: true, legacyRfId: true },
    });
    for (const c of clientRows) {
      if (c.legacyRfId != null) clientIdToLegacyRf.set(c.id, c.legacyRfId);
    }
  }
  const out: RFContact[] = [];
  for (const r of rows) {
    if (r.legacyRfId == null) continue;
    const raw = r.raw as RFContact | null;
    if (raw && typeof raw === "object") {
      out.push({ ...raw, id: r.legacyRfId });
      continue;
    }
    // Fallback shape.
    const clientRfId = r.clientId ? clientIdToLegacyRf.get(r.clientId) ?? null : null;
    out.push({
      id: r.legacyRfId,
      first_name: r.firstName,
      last_name: r.lastName,
      email: r.emails && r.emails.length > 0 ? r.emails : null,
      current_designation: r.currentDesignation,
      client_company_id: clientRfId,
    });
  }
  return out;
}
