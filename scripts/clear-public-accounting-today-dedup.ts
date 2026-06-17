// One-shot, idempotent: free TODAY's "Public Accounting - Nationwide" discovered
// companies from the 30-day cross-run dedup so they can be rediscovered and
// re-enrolled through the now-fixed enroll path (commit baef402: org matched by
// domain->org-id + idempotent, timeout-safe enroll). Today's batch enrolled zero
// decision-makers because of those bugs; this lets the same companies flow
// through discovery again so the fixed path can enroll them.
//
// THE DEDUP STORE
// The bd-discovery cron (src/app/api/cron/bd-discovery/route.ts) builds its
// dedup Set from the `discoveredPayload` of EVERY BDRun created in the last 30
// days — it does NOT filter by status (route.ts ~481-493). Each payload entry
// contributes a `companyName|jobTitle` fingerprint. So a company "resurfaces"
// only once it no longer appears in ANY recent run's payload. Clearing a
// company's fingerprint therefore means nulling the payload on the run(s) that
// hold it. A given saved search's run payload contains ONLY that search's own
// discovery output, so nulling THIS search's runs removes only Public Accounting
// Nationwide fingerprints and leaves every OTHER run (Great Neck / Tax / the
// org-wide cron / any other day) completely untouched.
//
// WHAT THIS TOUCHES
// - Identifies the Public Accounting Nationwide saved search(es) BY NAME
//   (case-insensitive contains, default token "Public Accounting"). This search
//   uses the default sequence, so name is the reliable scope; an optional
//   --sequence-id/--sequence-name adds sequence-handle matching if ever needed.
//   Any search whose name contains "Great Neck" is explicitly EXCLUDED so the
//   Great Neck batch can never be caught. Org-scoped.
// - Finds BDRuns for ONLY those saved searches, created TODAY (America/New_York).
// - On --apply, nulls discoveredPayload on ONLY the finished ones (COMPLETE /
//   FAILED). Live runs (QUEUED / RUNNING / AWAITING_APPROVAL / APPROVED /
//   ENROLLING) are REPORTED but NEVER cleared — an AWAITING_APPROVAL batch is a
//   pending approval you can enroll directly through the fixed path, and yanking
//   its payload would destroy it.
// - Great Neck / Tax / nationwide-cron companies live in different runs (and the
//   Great Neck name is excluded outright), so they are never selected.
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
//   npx tsx scripts/clear-public-accounting-today-dedup.ts            # dry run
//   npx tsx scripts/clear-public-accounting-today-dedup.ts --apply    # write
//   npx tsx scripts/clear-public-accounting-today-dedup.ts --org=<cuid> --apply

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// BreakPoint Talent is the only prod org today; keep it as the default so a
// bare run is still safely scoped, but allow --org=<cuid> for future re-runs.
const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc";

// Default scope: saved searches whose NAME contains this token (case-insensitive).
const DEFAULT_SEARCH_NAME_TOKEN = "Public Accounting";
// Never touch the Great Neck batch, whatever else matches.
const EXCLUDE_SEARCH_NAME_TOKEN = "Great Neck";
// Optional sequence-handle matching (off by default; Public Accounting uses the
// default sequence, so name is the reliable key). Provide via flags if needed.
const DEFAULT_SEQUENCE_ID = "";
const DEFAULT_SEQUENCE_NAME = "";

const ZONE = "America/New_York";

// Only these finished states are cleared by default. A run in any other state is
// mid-flight (or a pending approval batch) and must NOT have its payload yanked.
const CLEARABLE_STATUSES = ["COMPLETE", "FAILED"] as const;
const LIVE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "ENROLLING",
] as const;
// With --include-stuck, a run in one of these states is ALSO clearable, but ONLY
// when enrolledCount === 0 — i.e. a dead casualty of the pre-fix timeout/wrong-org
// enroll (approved/started but recorded zero, never reached COMPLETE). A run that
// enrolled anyone (enrolledCount > 0) is never touched, and AWAITING_APPROVAL /
// QUEUED / RUNNING are never touched, because those are genuinely live.
const STUCK_CLEARABLE_STATUSES = ["APPROVED", "ENROLLING"] as const;

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
  includeStuck: boolean;
  sequenceId: string;
  sequenceName: string;
  searchNameToken: string;
} {
  let orgId = DEFAULT_ORG_ID;
  let apply = false;
  let includeStuck = false;
  let sequenceId = DEFAULT_SEQUENCE_ID;
  let sequenceName = DEFAULT_SEQUENCE_NAME;
  let searchNameToken = DEFAULT_SEARCH_NAME_TOKEN;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg === "--include-stuck") includeStuck = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
    else if (arg.startsWith("--sequence-id=")) sequenceId = arg.slice("--sequence-id=".length);
    else if (arg.startsWith("--sequence-name=")) sequenceName = arg.slice("--sequence-name=".length);
    else if (arg.startsWith("--search-name=")) searchNameToken = arg.slice("--search-name=".length);
  }
  return { orgId, apply, includeStuck, sequenceId, sequenceName, searchNameToken };
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
  const { orgId, apply, includeStuck, sequenceId, sequenceName, searchNameToken } =
    parseArgs(process.argv);
  const todayStart = easternMidnightUtc();

  console.log(
    `\n${apply ? "APPLYING" : "DRY RUN"} — org ${orgId}\n` +
      `Saved-search name token: "${searchNameToken}" (case-insensitive contains)\n` +
      `Excluded name token: "${EXCLUDE_SEARCH_NAME_TOKEN}" (Great Neck never touched)\n` +
      (sequenceId || sequenceName
        ? `Optional sequence match: "${sequenceName}" (id=${sequenceId})\n`
        : `Sequence matching: off (name-scoped only)\n`) +
      `Include stuck (APPROVED/ENROLLING + enrolled=0) runs: ${includeStuck ? "YES" : "no"}\n` +
      `Today (America/New_York) starts at ${todayStart.toISOString()} (UTC).\n`,
  );

  // Optional: resolve a sequence row so searches mapped by its canonical table
  // name also match. Only used when a sequence id/name was provided.
  const acceptableHandles = new Set<string>();
  if (sequenceId || sequenceName) {
    const seqRow = sequenceId
      ? await prisma.bdSequence.findFirst({
          where: { organizationId: orgId, apolloSequenceId: sequenceId },
          select: { name: true, active: true },
        })
      : null;
    if (seqRow) {
      console.log(`BdSequence row: "${seqRow.name}" (active=${seqRow.active}).`);
    }
    [sequenceId, sequenceName, seqRow?.name]
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .forEach((s) => acceptableHandles.add(s.trim().toLowerCase()));
  }

  // All org saved searches; match in JS (criteria is Json).
  const allSearches = await prisma.savedSearch.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, criteria: true, verticalId: true },
  });

  type Matched = { id: string; name: string; reason: "sequence" | "name" };
  const matched: Matched[] = [];
  for (const s of allSearches) {
    // Hard exclude Great Neck no matter how it would otherwise match.
    if (s.name.toLowerCase().includes(EXCLUDE_SEARCH_NAME_TOKEN.toLowerCase())) continue;
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
      `\nNo Public Accounting Nationwide saved search found for this org ` +
        `(no name containing "${searchNameToken}"). Nothing to do.`,
    );
    return;
  }

  console.log(`\nMatched ${matched.length} saved search(es):`);
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
    console.log(`\nNo Public Accounting Nationwide BDRun created today. Nothing to clear.`);
    return;
  }

  const clearable: typeof runs = [];
  const liveSkipped: typeof runs = [];
  const alreadyNull: typeof runs = [];
  for (const r of runs) {
    if (r.discoveredPayload == null) {
      alreadyNull.push(r);
    } else if ((CLEARABLE_STATUSES as readonly string[]).includes(r.status)) {
      clearable.push(r);
    } else if (
      includeStuck &&
      (STUCK_CLEARABLE_STATUSES as readonly string[]).includes(r.status) &&
      r.enrolledCount === 0
    ) {
      // Dead casualty of the pre-fix enroll: approved/started but recorded zero
      // and never completed. Safe to free for re-discovery.
      clearable.push(r);
    } else if ((LIVE_STATUSES as readonly string[]).includes(r.status)) {
      liveSkipped.push(r);
    } else {
      alreadyNull.push(r); // unknown status w/ payload: be conservative, don't clear
    }
  }

  console.log(`\nPublic Accounting Nationwide BDRun(s) created today: ${runs.length}\n`);

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
        `the fixed enroll path; clearing it would destroy it. Resolve it manually if needed.`,
    );
  }

  for (const r of alreadyNull) {
    console.log(
      `  [SKIP] run ${r.id} status=${r.status} — payload already null or non-clearable, nothing to do.`,
    );
  }

  console.log(
    `\nWould clear ${clearable.length} run(s), freeing ${distinctCompanies.size} ` +
      `distinct Public Accounting company(ies) for re-discovery on the next bd-discovery cron.`,
  );
  if (liveSkipped.length > 0) {
    console.log(
      `WARNING: ${liveSkipped.length} live/pending run(s) still hold fingerprints ` +
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
    `\nCleared discoveredPayload on ${result.count} Public Accounting Nationwide run(s). ` +
      `Those companies can be re-discovered on the next bd-discovery cron run.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
