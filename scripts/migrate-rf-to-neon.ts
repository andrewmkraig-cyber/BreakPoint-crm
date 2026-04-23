// Phase 0 migration: pulls every RecruiterFlow record and mirrors it into
// Neon so Ace can switch to cuid FKs. Import-only: rows that already exist
// (matched by legacyRfId / rfId / email) are skipped unchanged, so a second
// run against the same data writes nothing. Candidates that collide on
// email with an Ace-native row get the RF id stamped on the Ace-native row
// — the Ace-native row becomes the canonical record and its fields are
// never overwritten from RF.
//
// Usage:
//   DATABASE_URL=<branch> npx tsx scripts/migrate-rf-to-neon.ts --dry-run
//   DATABASE_URL=<branch> npx tsx scripts/migrate-rf-to-neon.ts
//
// Requires RECRUITERFLOW_API_KEY in env for RF pulls. Phase 5 will delete
// this script and the key.

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  recruiterflow,
  type RFCandidate,
  type RFClient,
  type RFContact,
  type RFJob,
} from "../src/lib/recruiterflow";

type Counts = { created: number; linked: number; skipped: number };
type BackfillCounts = { updated: number; skipped: number; unlinkable: number; conflicted: number };

const DRY_RUN = process.argv.includes("--dry-run");
const DEFAULT_CREATED_BY_EMAIL = "andrew@breakpointtalent.com";

// ---------- RF value extractors ----------

function pickFirstEmail(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function pickFirstPhone(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object" && "number" in v) {
        const n = (v as { number?: unknown }).number;
        if (typeof n === "string" && n.trim()) return n.trim();
      }
    }
  }
  return null;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t === "string" && t.trim()) out.push(t.trim());
    else if (t && typeof t === "object" && "name" in t) {
      const name = (t as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
  }
  return out;
}

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: "(unnamed)", last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function rfNotesToText(notes: unknown): string | null {
  if (!Array.isArray(notes)) return null;
  const chunks: string[] = [];
  for (const n of notes) {
    if (n && typeof n === "object" && "note" in n) {
      const body = (n as { note?: unknown }).note;
      if (typeof body === "string" && body.trim()) chunks.push(body.trim());
    }
  }
  return chunks.length ? chunks.join("\n\n---\n\n") : null;
}

// JSON.stringify with sorted keys — used for deep-equality checks on fields
// stored as Json in Postgres. We don't want spurious UPDATEs when RF's API
// returns identical data with a different key order.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

function jsonEq(a: unknown, b: unknown): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}

function dateEq(a: Date | null, b: Date | null | undefined): boolean {
  const av = a ? a.getTime() : null;
  const bv = b ? b.getTime() : null;
  return av === bv;
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------- RF → Ace row shapers ----------

function shapeClient(c: RFClient) {
  return {
    legacyRfId: c.id,
    name: (c.name ?? "").trim() || "(unnamed)",
    domain: c.domain ?? null,
    industry: c.industry ?? null,
    linkedinPage: c.linkedin_page ?? null,
    careersPage: c.careers_page ?? null,
    companySize: c.company_size ?? null,
    overview: c.overview ?? null,
    location: (c.location ?? null) as object | null,
    phoneNumbers: (c.phone_number ?? null) as object | null,
    tags: normalizeTags(c.tags),
    status: (c.status ?? null) as object | null,
    revenue: (c.revenue ?? null) as object | null,
    leadOwner: (c.lead_owner ?? null) as object | null,
    customFields: (c.custom_fields ?? null) as object | null,
    addedAt: parseDate(c.added_time),
    lastContact: parseDate(c.last_contact),
    lastEngagement: parseDate(c.last_engagement),
    raw: c as unknown as object,
  };
}

function shapeJob(j: RFJob, clientByRfId: Map<number, string>) {
  const clientRfId = j.company?.id ?? null;
  return {
    legacyRfId: j.id,
    title: j.title ?? j.name ?? "(untitled)",
    clientId: clientRfId != null ? clientByRfId.get(clientRfId) ?? null : null,
    locations: Array.isArray(j.locations) ? j.locations.filter((x): x is string => typeof x === "string") : [],
    isOpen: Boolean(j.is_open),
    jobStatus: (j.job_status ?? null) as object | null,
    jobType: (j.job_type ?? null) as object | null,
    employmentType: j.employment_type ?? null,
    department: j.department ?? null,
    salaryRangeStart: typeof j.salary_range_start === "number" ? j.salary_range_start : null,
    salaryRangeEnd: typeof j.salary_range_end === "number" ? j.salary_range_end : null,
    salaryCurrency: j.salary_range_currency ?? null,
    salaryFrequency: j.salary_frequency ?? null,
    expectedFee: (j.expected_fee ?? null) as object | null,
    billRate: (j.bill_rate ?? null) as object | null,
    payRate: (j.pay_rate ?? null) as object | null,
    numberOfOpenings: typeof j.number_of_openings === "number" ? j.number_of_openings : null,
    currentOpening: typeof j.current_opening === "number" ? j.current_opening : null,
    hiringTeam: (j.hiring_team ?? null) as object | null,
    customFields: (j.custom_fields ?? null) as object | null,
    applyLink: j.apply_link ?? null,
    lastOpenedAt: parseDate(j.last_opened),
    createdAtRf: parseDate(j.created_at),
    raw: j as unknown as object,
  };
}

function shapeContact(c: RFContact, clientByRfId: Map<number, string>) {
  const emails: string[] = [];
  if (Array.isArray(c.email)) {
    for (const e of c.email) if (typeof e === "string" && e.trim()) emails.push(e.trim());
  } else if (typeof c.email === "string" && c.email.trim()) {
    emails.push(c.email.trim());
  }
  const clientRfId = c.client_company_id ?? null;
  const composedName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.name || null;
  return {
    legacyRfId: c.id,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    name: composedName,
    emails,
    phoneNumbers: (c.phone_number ?? null) as object | null,
    clientId: clientRfId != null ? clientByRfId.get(clientRfId) ?? null : null,
    currentDesignation: c.current_designation ?? null,
    linkedinProfile: c.linkedin_profile ?? null,
    leadOwner: (c.lead_owner ?? null) as object | null,
    addedAt: parseDate(c.added_time),
    lastActivityAt: parseDate(c.latest_activity_time),
    raw: c as unknown as object,
  };
}

function shapeCandidate(c: RFCandidate) {
  const first = c.first_name ?? (c.name ? splitName(c.name).first : null);
  const last = c.last_name ?? (c.name ? splitName(c.name).last : null);
  const firstName = (first && first.trim()) || "(unnamed)";
  const lastName = last && last.trim() ? last.trim() : null;
  const email = pickFirstEmail(c.email);
  const phone = pickFirstPhone(c.phone_number);
  const location = typeof c.location === "object" && c.location
    ? [c.location.city, c.location.state, c.location.country].filter(Boolean).join(", ") || null
    : null;
  const skills = normalizeTags(
    Array.isArray((c as { skills?: unknown }).skills)
      ? (c as { skills?: unknown }).skills
      : null,
  );
  return {
    rfId: c.id,
    firstName,
    lastName,
    email,
    phone,
    currentDesignation: c.current_designation ?? null,
    currentOrganization: c.current_organization ?? null,
    location,
    linkedinProfile: c.linkedin_profile ?? null,
    skills,
    notes: rfNotesToText(c.notes),
    experience: ((c as { experience?: unknown }).experience ?? null) as object | null,
    education: ((c as { education?: unknown }).education ?? null) as object | null,
  };
}

// ---------- Upsert helpers (import-only: create if missing, else skip) ----------

async function upsertClients(rf: RFClient[]): Promise<Counts> {
  const existing = await prisma.client.findMany({
    where: { legacyRfId: { not: null } },
    select: { id: true, legacyRfId: true },
  });
  const byRfId = new Set(existing.map((r) => r.legacyRfId as number));
  const counts: Counts = { created: 0, linked: 0, skipped: 0 };

  for (const c of rf) {
    if (byRfId.has(c.id)) {
      counts.skipped += 1;
      continue;
    }
    counts.created += 1;
    if (!DRY_RUN) {
      await prisma.client.create({ data: shapeClient(c) as unknown as Prisma.ClientCreateInput });
    }
  }
  return counts;
}

async function upsertJobs(rf: RFJob[], clientByRfId: Map<number, string>): Promise<Counts> {
  const existing = await prisma.job.findMany({
    where: { legacyRfId: { not: null } },
    select: { id: true, legacyRfId: true },
  });
  const byRfId = new Set(existing.map((r) => r.legacyRfId as number));
  const counts: Counts = { created: 0, linked: 0, skipped: 0 };

  for (const j of rf) {
    if (byRfId.has(j.id)) {
      counts.skipped += 1;
      continue;
    }
    counts.created += 1;
    if (!DRY_RUN) {
      await prisma.job.create({ data: shapeJob(j, clientByRfId) as unknown as Prisma.JobCreateInput });
    }
  }
  return counts;
}

async function upsertContacts(rf: RFContact[], clientByRfId: Map<number, string>): Promise<Counts> {
  const existing = await prisma.contact.findMany({
    where: { legacyRfId: { not: null } },
    select: { id: true, legacyRfId: true },
  });
  const byRfId = new Set(existing.map((r) => r.legacyRfId as number));
  const counts: Counts = { created: 0, linked: 0, skipped: 0 };

  for (const c of rf) {
    if (byRfId.has(c.id)) {
      counts.skipped += 1;
      continue;
    }
    counts.created += 1;
    if (!DRY_RUN) {
      await prisma.contact.create({ data: shapeContact(c, clientByRfId) as unknown as Prisma.ContactCreateInput });
    }
  }
  return counts;
}

// Candidate upsert has one extra branch: if an RF candidate's email matches
// an existing Ace-native row (no rfId), stamp the RF id onto the Ace-native
// row rather than creating a duplicate. The Ace-native row becomes the
// canonical record — its fields are never overwritten from RF.
async function upsertCandidates(rf: RFCandidate[], createdById: string): Promise<Counts> {
  const existing = await prisma.candidate.findMany({ select: { id: true, rfId: true, email: true } });
  const byRfId = new Map<number, { id: string; rfId: number | null; email: string | null }>(
    existing.filter((r) => r.rfId != null).map((r) => [r.rfId as number, r]),
  );
  const allByEmail = new Map<string, { id: string; rfId: number | null }>();
  for (const r of existing) {
    if (r.email) allByEmail.set(r.email.toLowerCase(), { id: r.id, rfId: r.rfId });
  }
  const counts: Counts = { created: 0, linked: 0, skipped: 0 };

  for (const c of rf) {
    const shaped = shapeCandidate(c);

    // Email-collision path: link Ace-native row to this RF id.
    if (shaped.email) {
      const hit = allByEmail.get(shaped.email.toLowerCase());
      if (hit) {
        if (hit.rfId === c.id) {
          // Already linked on a prior run — idempotent skip.
          counts.skipped += 1;
          continue;
        }
        if (hit.rfId == null) {
          counts.linked += 1;
          console.log(`  [candidate] rf=${c.id} email=${shaped.email} → linking Ace ${hit.id} (rfId set)`);
          if (!DRY_RUN) {
            await prisma.candidate.update({ where: { id: hit.id }, data: { rfId: c.id } });
          }
          // Refresh in-memory maps so downstream FK backfill resolves this id.
          allByEmail.set(shaped.email.toLowerCase(), { id: hit.id, rfId: c.id });
          byRfId.set(c.id, { id: hit.id, rfId: c.id, email: shaped.email });
          continue;
        }
        // Some OTHER Ace candidate already owns this email with a different
        // rfId. Don't silently overwrite — log and skip.
        console.log(`  [candidate] rf=${c.id} email=${shaped.email} conflicts with Ace ${hit.id} (rfId=${hit.rfId}) — skipping`);
        counts.skipped += 1;
        continue;
      }
    }

    // rfId-match path: existing migration row, leave untouched (import-only).
    if (byRfId.has(c.id)) {
      counts.skipped += 1;
      continue;
    }

    counts.created += 1;
    if (!DRY_RUN) {
      await prisma.candidate.create({ data: { ...shaped, createdById } as unknown as Prisma.CandidateUncheckedCreateInput });
    }
  }
  return counts;
}

// ---------- FK backfill ----------

async function backfillForeignKeys(maps: {
  clientByRfId: Map<number, string>;
  jobByRfId: Map<number, string>;
  candidateByRfId: Map<number, string>;
}): Promise<Record<string, BackfillCounts>> {
  const out: Record<string, BackfillCounts> = {};

  out["Placement.jobId"] = await backfillFk(
    await prisma.placement.findMany({ where: { jobId: null, jobRfId: { not: null } }, select: { id: true, jobRfId: true } }),
    (row) => row.jobRfId != null ? maps.jobByRfId.get(row.jobRfId) ?? null : null,
    (key, value) => prisma.placement.update({ where: { id: key as string }, data: { jobId: value } }),
  );
  out["Placement.clientId"] = await backfillFk(
    await prisma.placement.findMany({ where: { clientId: null, clientRfId: { not: null } }, select: { id: true, clientRfId: true } }),
    (row) => row.clientRfId != null ? maps.clientByRfId.get(row.clientRfId) ?? null : null,
    (key, value) => prisma.placement.update({ where: { id: key as string }, data: { clientId: value } }),
  );
  // Placement has unique constraints on (candidateId, jobRfId) and
  // (candidateId, jobId). If Ace-native already owns a Placement for the
  // same (candidate, job) pair as an RF-path row, backfilling candidateId on
  // the RF-path row would violate the unique. Pre-compute occupied pairs and
  // flag such rows as conflicted rather than failing.
  const placementOccupied = new Set<string>();
  for (const p of await prisma.placement.findMany({
    where: { candidateId: { not: null } },
    select: { candidateId: true, jobRfId: true, jobId: true },
  })) {
    placementOccupied.add(`${p.candidateId}|${p.jobRfId}`);
    if (p.jobId) placementOccupied.add(`${p.candidateId}|${p.jobId}`);
  }
  out["Placement.candidateId"] = await backfillFk(
    await prisma.placement.findMany({ where: { candidateId: null, candidateRfId: { not: null } }, select: { id: true, candidateRfId: true, jobRfId: true, jobId: true } }),
    (row) => {
      if (row.candidateRfId == null) return null;
      const target = maps.candidateByRfId.get(row.candidateRfId);
      if (!target) return null;
      if (
        placementOccupied.has(`${target}|${row.jobRfId}`) ||
        (row.jobId && placementOccupied.has(`${target}|${row.jobId}`))
      ) {
        return "conflict";
      }
      return target;
    },
    (key, value) => prisma.placement.update({ where: { id: key as string }, data: { candidateId: value } }),
  );

  out["Interview.jobId"] = await backfillFk(
    await prisma.interview.findMany({ where: { jobId: null, jobRfId: { not: null } }, select: { id: true, jobRfId: true } }),
    (row) => row.jobRfId != null ? maps.jobByRfId.get(row.jobRfId) ?? null : null,
    (key, value) => prisma.interview.update({ where: { id: key as string }, data: { jobId: value } }),
  );
  out["Interview.clientId"] = await backfillFk(
    await prisma.interview.findMany({ where: { clientId: null, clientRfId: { not: null } }, select: { id: true, clientRfId: true } }),
    (row) => row.clientRfId != null ? maps.clientByRfId.get(row.clientRfId) ?? null : null,
    (key, value) => prisma.interview.update({ where: { id: key as string }, data: { clientId: value } }),
  );
  out["Interview.candidateId"] = await backfillFk(
    await prisma.interview.findMany({ where: { candidateId: null, candidateRfId: { not: null } }, select: { id: true, candidateRfId: true } }),
    (row) => row.candidateRfId != null ? maps.candidateByRfId.get(row.candidateRfId) ?? null : null,
    (key, value) => prisma.interview.update({ where: { id: key as string }, data: { candidateId: value } }),
  );

  out["ClientAgreement.clientId"] = await backfillFk(
    await prisma.clientAgreement.findMany({ where: { clientId: null }, select: { id: true, clientRfId: true } }),
    (row) => maps.clientByRfId.get(row.clientRfId) ?? null,
    (key, value) => prisma.clientAgreement.update({ where: { id: key as string }, data: { clientId: value } }),
  );
  out["ClientBenefits.clientId"] = await backfillFk(
    await prisma.clientBenefits.findMany({ where: { clientId: null }, select: { id: true, clientRfId: true } }),
    (row) => maps.clientByRfId.get(row.clientRfId) ?? null,
    (key, value) => prisma.clientBenefits.update({ where: { id: key as string }, data: { clientId: value } }),
  );
  out["ClientBenefitsFile.clientId"] = await backfillFk(
    await prisma.clientBenefitsFile.findMany({ where: { clientId: null }, select: { id: true, clientRfId: true } }),
    (row) => maps.clientByRfId.get(row.clientRfId) ?? null,
    (key, value) => prisma.clientBenefitsFile.update({ where: { id: key as string }, data: { clientId: value } }),
  );

  out["CandidateResume.candidateId"] = await backfillFk(
    await prisma.candidateResume.findMany({ where: { candidateId: null }, select: { id: true, candidateRfId: true } }),
    (row) => maps.candidateByRfId.get(row.candidateRfId) ?? null,
    (key, value) => prisma.candidateResume.update({ where: { id: key as string }, data: { candidateId: value } }),
  );

  out["JobOverride.jobId"] = await backfillFk(
    await prisma.jobOverride.findMany({ where: { jobId: null }, select: { jobRfId: true } }),
    (row) => maps.jobByRfId.get(row.jobRfId) ?? null,
    (key, value) => prisma.jobOverride.update({ where: { jobRfId: key as number }, data: { jobId: value } }),
    (row) => row.jobRfId,
  );

  out["KrispcallLog.candidateId"] = await backfillFk(
    await prisma.krispcallLog.findMany({ where: { candidateId: null, candidateRfId: { not: null } }, select: { id: true, candidateRfId: true } }),
    (row) => {
      if (!row.candidateRfId) return null;
      const n = Number(row.candidateRfId);
      if (Number.isNaN(n)) return null;
      return maps.candidateByRfId.get(n) ?? null;
    },
    (key, value) => prisma.krispcallLog.update({ where: { id: key as string }, data: { candidateId: value } }),
  );

  return out;
}

async function backfillFk<T extends Record<string, unknown>>(
  rows: T[],
  resolve: (row: T) => string | "conflict" | null,
  apply: (key: string | number, value: string) => Promise<unknown>,
  extractKey?: (row: T) => string | number,
): Promise<BackfillCounts> {
  const counts: BackfillCounts = { updated: 0, skipped: 0, unlinkable: 0, conflicted: 0 };
  for (const row of rows) {
    const resolved = resolve(row);
    if (resolved === "conflict") {
      counts.conflicted += 1;
      continue;
    }
    if (!resolved) {
      counts.unlinkable += 1;
      continue;
    }
    counts.updated += 1;
    if (!DRY_RUN) {
      const key = extractKey ? extractKey(row) : (row.id as string);
      await apply(key, resolved);
    }
  }
  return counts;
}

// ---------- main ----------

async function main(): Promise<void> {
  console.log(`\n=== RF → Neon migration ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"} ===\n`);

  const user = await prisma.user.findFirst({
    where: { email: DEFAULT_CREATED_BY_EMAIL },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`Default createdBy user ${DEFAULT_CREATED_BY_EMAIL} not found in Neon — aborting`);
  }

  console.log("Fetching from RecruiterFlow…");
  const [rfClients, rfJobs, rfContacts, rfCandidates] = await Promise.all([
    recruiterflow.listAllClients({ perPage: 100 }),
    recruiterflow.listAllJobs({ perPage: 100 }),
    recruiterflow.listAllContacts({ perPage: 100 }),
    recruiterflow.listAllCandidates({ perPage: 100 }),
  ]);
  console.log(
    `Fetched: ${rfClients.length} clients, ${rfJobs.length} jobs, ${rfContacts.length} contacts, ${rfCandidates.length} candidates\n`,
  );

  console.log("Upserting Client rows…");
  const clientCounts = await upsertClients(rfClients);

  const clientByRfId = new Map(
    (await prisma.client.findMany({ select: { id: true, legacyRfId: true }, where: { legacyRfId: { not: null } } }))
      .map((r) => [r.legacyRfId as number, r.id]),
  );
  // In dry-run, the above map is missing rows we would have created. Augment
  // with the in-memory RF list so downstream diffs see the would-be ids.
  if (DRY_RUN) {
    for (const c of rfClients) {
      if (!clientByRfId.has(c.id)) clientByRfId.set(c.id, `<would-create:client:${c.id}>`);
    }
  }

  console.log("Upserting Job rows…");
  const jobCounts = await upsertJobs(rfJobs, clientByRfId);
  const jobByRfId = new Map(
    (await prisma.job.findMany({ select: { id: true, legacyRfId: true }, where: { legacyRfId: { not: null } } }))
      .map((r) => [r.legacyRfId as number, r.id]),
  );
  if (DRY_RUN) {
    for (const j of rfJobs) {
      if (!jobByRfId.has(j.id)) jobByRfId.set(j.id, `<would-create:job:${j.id}>`);
    }
  }

  console.log("Upserting Contact rows…");
  const contactCounts = await upsertContacts(rfContacts, clientByRfId);

  console.log("Upserting Candidate rows…");
  const candidateCounts = await upsertCandidates(rfCandidates, user.id);
  const candidateByRfId = new Map(
    (await prisma.candidate.findMany({ select: { id: true, rfId: true }, where: { rfId: { not: null } } }))
      .map((r) => [r.rfId as number, r.id]),
  );
  if (DRY_RUN) {
    for (const c of rfCandidates) {
      if (!candidateByRfId.has(c.id)) candidateByRfId.set(c.id, `<would-create:candidate:${c.id}>`);
    }
  }

  console.log("Backfilling FK columns…");
  const backfillCounts = await backfillForeignKeys({ clientByRfId, jobByRfId, candidateByRfId });

  console.log("\n=== Summary ===");
  const fmt = (c: Counts) => `+${c.created} created, ↔${c.linked} linked, =${c.skipped} skipped`;
  console.log(`Client:    ${fmt(clientCounts)}`);
  console.log(`Job:       ${fmt(jobCounts)}`);
  console.log(`Contact:   ${fmt(contactCounts)}`);
  console.log(`Candidate: ${fmt(candidateCounts)}`);
  console.log("\nFK backfill:");
  for (const [table, counts] of Object.entries(backfillCounts)) {
    const parts = [`linked=${counts.updated}`, `unlinkable=${counts.unlinkable}`];
    if (counts.conflicted > 0) parts.push(`conflicted=${counts.conflicted}`);
    console.log(`  ${table.padEnd(30)} ${parts.join(" ")}`);
  }
  console.log(`\n${DRY_RUN ? "⚠️  DRY RUN — no changes were written." : "✅ Live migration complete."}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
