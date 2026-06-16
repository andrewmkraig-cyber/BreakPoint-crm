// One-shot, idempotent: free TODAY's "Great Neck BD" discovered companies from
// the 30-day cross-run dedup so they can be rediscovered and re-enrolled through
// the now-fixed sequence-routing path (commit 8dd7a4c). Their first enroll went
// to the WRONG Apollo sequence (the Tax/default sequence) because the enroll
// path ignored the saved search's mapping; this lets them flow through again.
//
// THE DEDUP STORE
// The bd-discovery cron (src/app/api/cron/bd-discovery/route.ts) builds its
// dedup Set from the `discoveredPayload` of EVERY BDRun created in the last 30
// days — it does NOT filter by status (route.ts ~481-493). Each payload entry
// contributes a `companyName|jobTitle` fingerprint. So a company "resurfaces"
// only once it no longer appears in ANY recent run's payload. Clearing a
// company's fingerprint therefore means nulling the payload on the run(s) that
// hold it. A Great Neck run's payload contains ONLY Great Neck companies (it is
// that saved search's own discovery output), so nulling those runs' payloads
// removes Great Neck fingerprints and leaves every OTHER run (Tax / nationwide /
// org-wide cron) completely untouched.
//
// WHAT THIS TOUCHES
// - Identifies the Great Neck saved search(es): those whose mapped sequence
//   (criteria.apolloSequenceId) is the Great Neck BD sequence (by id or name),
//   with a saved-search-NAME-contains fallback. Org-scoped.
// - Finds BDRuns for ONLY those saved searches, created TODAY (America/New_York).
// - On --apply, nulls discoveredPayload on ONLY the finished ones (COMPLETE /
//   FAILED). Live runs (QUEUED / RUNNING / AWAITING_APPROVAL / APPROVED) are
//   REPORTED but NEVER cleared — an AWAITING_APPROVAL Great Neck batch is a
//   pending approval you can just enroll through the fixed path; yanking its
//   payload would destroy it.
// - Tax BD / nationwide companies live in different runs and are never selected.
//
// SAFETY
// Dry-run by default: prints which saved search/run, how many companies, and
// their names, then STOPS. Pass --apply to write. Scoped to one organization;
// defaults to BreakPoint Talent, override with --org=<cuid>. Idempotent: once a
// run's payload is null it is dropped from the report and the write, so a re-run
// after --apply reports "nothing to clear".
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/clear-great-neck-today-dedup.ts            # dry run
//   npx tsx scripts/clear-great-neck-today-dedup.ts --apply    # write
//   npx tsx scripts/clear-great-neck-today-dedup.ts --org=<cuid> --apply

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// BreakPoint Talent is the only prod org today; keep it as the default so a
// bare run is still safely scoped, but allow --org=<cuid> for future re-runs.
const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc";

// The Great Neck BD sequence, as added via the self-serve BdSequence table.
const DEFAULT_SEQUENCE_ID = "6a3057feaed6610020449ca9";
const DEFAULT_SEQUENCE_NAME = "Great Neck BD";
// Saved-search NAME fallback token (case-insensitive contains) for searches
// that weren't mapped via criteria.apolloSequenceId.
const DEFAULT_SEARCH_NAME_TOKEN = "Great Neck";

const ZONE = "America/New_York";

// Only these finished states are cleared. A run in any other state is mid-flight
// (or a pending approval batch) and must NOT have its payload yanked.
const CLEARABLE_STATUSES = ["COMPLETE", "FAILED"] as const;
const LIVE_STATUSES = ["QUEUED", "RUNNING", "AWAITING_APPROVAL", "APPROVED"] as const;

// Start of the current America/New_York calendar day, as a UTC instant. Mirrors
// easternMidnightUtc() in src/lib/bd/apollo-enroll.ts so "today" matches the
// enroll path's notion of the ET day (DST-correct via the live offset).
function easternMidnightUtc(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = ymd.split("-").map(Number);
  const placeholder = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetToken =
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    })
      .formatToParts(placeholder)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = offsetToken.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const sign = match && match[1] === "+" ? 1 : -1;
  const hours = match ? Number(match[2]) : 5;
  const mins = match && match[3] ? Number(match[3]) : 0;
  const offsetMinutes = sign * (hours * 60 + mins);
  return new Date(placeholder.getTime() - offsetMinutes * 60_000);
}

function parseArgs(argv: string[]): {
  orgId: string;
  apply: boolean;
  sequenceId: string;
  sequenceName: string;
  searchNameToken: string;
} {
  let orgId = DEFAULT_ORG_ID;
  let apply = false;
  let sequenceId = DEFAULT_SEQUENCE_ID;
  let sequenceName = DEFAULT_SEQUENCE_NAME;
  let searchNameToken = DEFAULT_SEARCH_NAME_TOKEN;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
    else if (arg.startsWith("--sequence-id=")) sequenceId = arg.slice("--sequence-id=".length);
    else if (arg.startsWith("--sequence-name=")) sequenceName = arg.slice("--sequence-name=".length);
    else if (arg.startsWith("--search-name=")) searchNameToken = arg.slice("--search-name=".length);
  }
  return { orgId, apply, sequenceId, sequenceName, searchNameToken };
}

// Mirrors the cron's own array/object guards: count company/job fingerprints a
// payload contributes to the dedup window.
function fingerprintCount(payload: unknown): number {
  if (!Array.isArray(payload)) return 0;
  let n = 0;
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.companyName === "string" ? obj.companyName : "";
    const title = typeof obj.jobTitle === "string" ? obj.jobTitle : "";
    if (name && title) n++;
  }
  return n;
}

// Distinct company names in a payload (for the eyeball report).
function companyNames(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const name = (item as Record<string, unknown>).companyName;
    if (typeof name === "string" && name.trim()) {
      const key = name.trim();
      const lk = key.toLowerCase();
      if (!seen.has(lk)) {
        seen.add(lk);
        out.push(key);
      }
    }
  }
  return out;
}

function criteriaSequenceHandle(criteria: unknown): string | null {
  if (!criteria || typeof criteria !== "object") return null;
  const v = (criteria as Record<string, unknown>).apolloSequenceId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function main(): Promise<void> {
  const { orgId, apply, sequenceId, sequenceName, searchNameToken } = parseArgs(process.argv);
  const todayStart = easternMidnightUtc();

  console.log(
    `\n${apply ? "APPLYING" : "DRY RUN"} — org ${orgId}\n` +
      `Target sequence: "${sequenceName}" (id=${sequenceId})\n` +
      `Saved-search name fallback token: "${searchNameToken}"\n` +
      `Today (America/New_York) starts at ${todayStart.toISOString()} (UTC).\n`,
  );

  // Resolve the Great Neck BD sequence row so we can also match saved searches
  // mapped by its canonical table name (not just the provided default name).
  const seqRow = await prisma.bdSequence.findFirst({
    where: { organizationId: orgId, apolloSequenceId: sequenceId },
    select: { name: true, active: true },
  });
  if (seqRow) {
    console.log(`BdSequence row: "${seqRow.name}" (active=${seqRow.active}).`);
  } else {
    console.log(
      `No BdSequence row with apolloSequenceId=${sequenceId} for this org ` +
        `(matching on name/id only).`,
    );
  }

  // The set of handle strings that mean "Great Neck BD" (lowercased).
  const acceptableHandles = new Set<string>(
    [sequenceId, sequenceName, seqRow?.name]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().toLowerCase()),
  );

  // All org saved searches; match in JS (criteria is Json).
  const allSearches = await prisma.savedSearch.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, criteria: true, verticalId: true },
  });

  type Matched = { id: string; name: string; reason: "sequence" | "name" };
  const matched: Matched[] = [];
  for (const s of allSearches) {
    const handle = criteriaSequenceHandle(s.criteria);
    if (handle && acceptableHandles.has(handle.toLowerCase())) {
      matched.push({ id: s.id, name: s.name, reason: "sequence" });
    } else if (
      searchNameToken &&
      s.name.toLowerCase().includes(searchNameToken.toLowerCase())
    ) {
      matched.push({ id: s.id, name: s.name, reason: "name" });
    }
  }

  if (matched.length === 0) {
    console.log(
      `\nNo Great Neck saved search found for this org ` +
        `(neither a sequence mapping to "${sequenceName}"/${sequenceId} nor a ` +
        `name containing "${searchNameToken}"). Nothing to do.`,
    );
    return;
  }

  console.log(`\nMatched ${matched.length} Great Neck saved search(es):`);
  for (const m of matched) {
    console.log(`  - "${m.name}" (id=${m.id}, matched by ${m.reason})`);
  }

  // BDRuns for ONLY those saved searches, created today (ET), org-scoped.
  const runs = await prisma.bDRun.findMany({
    where: {
      organizationId: orgId,
      savedSearchId: { in: matched.map((m) => m.id) },
      createdAt: { gte: todayStart },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      discoveredCount: true,
      enrolledCount: true,
      discoveredPayload: true,
      savedSearchId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const searchNameById = new Map(matched.map((m) => [m.id, m.name]));

  if (runs.length === 0) {
    console.log(`\nNo Great Neck BDRun created today. Nothing to clear.`);
    return;
  }

  const clearable: typeof runs = [];
  const liveSkipped: typeof runs = [];
  const alreadyNull: typeof runs = [];
  for (const r of runs) {
    if (r.discoveredPayload == null) alreadyNull.push(r);
    else if ((CLEARABLE_STATUSES as readonly string[]).includes(r.status)) clearable.push(r);
    else if ((LIVE_STATUSES as readonly string[]).includes(r.status)) liveSkipped.push(r);
    else alreadyNull.push(r); // unknown status w/ payload: be conservative, don't clear
  }

  console.log(`\nGreat Neck BDRun(s) created today: ${runs.length}\n`);

  const distinctCompanies = new Set<string>();
  for (const r of clearable) {
    const names = companyNames(r.discoveredPayload);
    names.forEach((n) => distinctCompanies.add(n.toLowerCase()));
    console.log(
      `  [CLEAR] run ${r.id}  search="${searchNameById.get(r.savedSearchId ?? "") ?? "?"}"\n` +
        `          status=${r.status} created=${r.createdAt.toISOString()} ` +
        `discovered=${r.discoveredCount} enrolled=${r.enrolledCount} ` +
        `fingerprints=${fingerprintCount(r.discoveredPayload)}\n` +
        `          companies (${names.length}): ${names.join(", ") || "(none)"}`,
    );
  }

  for (const r of liveSkipped) {
    const names = companyNames(r.discoveredPayload);
    console.log(
      `  [SKIP-LIVE] run ${r.id}  search="${searchNameById.get(r.savedSearchId ?? "") ?? "?"}"\n` +
        `          status=${r.status} (live/pending — NOT cleared) ` +
        `created=${r.createdAt.toISOString()} companies (${names.length}): ` +
        `${names.join(", ") || "(none)"}\n` +
        `          NOTE: an AWAITING_APPROVAL batch can be enrolled directly through ` +
        `the fixed sequence path; clearing it would destroy it. Resolve it manually if needed.`,
    );
  }

  for (const r of alreadyNull) {
    console.log(
      `  [SKIP] run ${r.id} status=${r.status} — payload already null or non-clearable, nothing to do.`,
    );
  }

  console.log(
    `\nWould clear ${clearable.length} run(s), freeing ${distinctCompanies.size} ` +
      `distinct Great Neck company(ies) for re-discovery on the next bd-discovery cron.`,
  );
  if (liveSkipped.length > 0) {
    console.log(
      `WARNING: ${liveSkipped.length} live/pending Great Neck run(s) still hold fingerprints ` +
        `and were NOT cleared (see [SKIP-LIVE] above).`,
    );
  }

  if (!apply) {
    console.log(`\nDry run — no changes written. Re-run with --apply to clear.`);
    return;
  }

  if (clearable.length === 0) {
    console.log(`\nNothing clearable. No writes.`);
    return;
  }

  // Null discoveredPayload on exactly the clearable run ids. Prisma.DbNull sets
  // the column to SQL NULL; the cron's `!Array.isArray(payload)` guard then
  // contributes zero fingerprints for these runs, so their companies resurface.
  const result = await prisma.bDRun.updateMany({
    where: { id: { in: clearable.map((r) => r.id) }, organizationId: orgId },
    data: { discoveredPayload: Prisma.DbNull },
  });

  console.log(
    `\nCleared discoveredPayload on ${result.count} Great Neck run(s). ` +
      `Those companies can be re-discovered on the next bd-discovery cron run.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
