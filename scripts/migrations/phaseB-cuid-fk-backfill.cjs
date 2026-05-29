/* Ace 69.0 — Phase B: cuid foreign-key backfill (idempotent, re-runnable).
 *
 * Goal: every row keyed only by a numeric *RfId also carries its cuid FK
 * (candidateId / jobId / clientId), so a later code cutover can drop all
 * legacyRfId branches safely. Additive only — fills NULL cuid FKs, never
 * overwrites an existing cuid. Org-scoped (rule 8). Safe to run repeatedly.
 *
 * Run: node scripts/migrations/phaseB-cuid-fk-backfill.cjs
 * (Reads DATABASE_URL from process.env, falling back to .env.local.)
 *
 * What this performed on first run (BreakPoint Talent org, 2026-05-29):
 *   Step 2a — additive backfill via parent rfId/legacyRfId @unique: 64 cells
 *     Placement: 15 candidateId, 7 jobId, 0 clientId
 *     Interview:  3 candidateId, 18 jobId, 21 clientId
 *     (CandidateResume + ClientAgreement/Benefits/BenefitsFile already 100%.)
 *   Step 2b — synthetic-id resolver for shim-bug rows whose jobRfId was a
 *     negative syntheticIdFromCuid() value (Ace-native rows the shim mis-keyed):
 *     4 of 5 resolved (1 Interview + 3 Interviews); jobId/clientId set, bogus
 *     jobRfId / clientRfId=0 nulled. 1 Placement was HELD (would have violated
 *     @@unique([candidateId, jobId]) — it was a duplicate of an existing
 *     canonical placement).
 *
 * NOT part of this re-runnable backfill (documented for the audit trail):
 *   - The held duplicate, Placement cmppmk6i90003 (Jordan Blake / Tax Manager,
 *     stage "interviewing"), was a phantom created by the interview-schedule
 *     flow. It was reconciled MANUALLY as a one-off: the canonical placement
 *     cmppklewk0001... was advanced submitted -> interviewing and the phantom
 *     deleted. The scheduled interview (cmppmk6f90001...) stays attached to the
 *     canonical row via its (candidateId, jobId) join key (no placementId FK).
 *   - Placement cmp2028ns0001... (rejected, candidateRfId=60) is a true RF
 *     orphan (candidate not in-org); left untouched intentionally.
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  const m = fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (m) process.env.DATABASE_URL = m[1];
}
const prisma = new PrismaClient();

// Exact replica of src/lib/candidates.ts:syntheticIdFromCuid — used to reverse
// the shim's negative djb2 id back to the source Job/Client cuid.
function syntheticIdFromCuid(cuid) {
  let hash = 5381;
  for (let i = 0; i < cuid.length; i++) hash = ((hash << 5) + hash + cuid.charCodeAt(i)) >>> 0;
  return -((hash & 0x7fffffff) || 1);
}

// child, cuidCol, rfCol, parent, parentCol
const FKS = [
  ["Placement", "candidateId", "candidateRfId", "Candidate", "rfId"],
  ["Placement", "jobId", "jobRfId", "Job", "legacyRfId"],
  ["Placement", "clientId", "clientRfId", "Client", "legacyRfId"],
  ["Interview", "candidateId", "candidateRfId", "Candidate", "rfId"],
  ["Interview", "jobId", "jobRfId", "Job", "legacyRfId"],
  ["Interview", "clientId", "clientRfId", "Client", "legacyRfId"],
  ["CandidateResume", "candidateId", "candidateRfId", "Candidate", "rfId"],
  ["ClientAgreement", "clientId", "clientRfId", "Client", "legacyRfId"],
  ["ClientBenefits", "clientId", "clientRfId", "Client", "legacyRfId"],
  ["ClientBenefitsFile", "clientId", "clientRfId", "Client", "legacyRfId"],
];

async function step2a() {
  console.log("=== Step 2a: additive cuid-FK backfill (parent rfId/legacyRfId @unique) ===");
  let total = 0;
  for (const [c, cuid, rf, p, pc] of FKS) {
    const n = await prisma.$executeRawUnsafe(`
      UPDATE "${c}" ch SET "${cuid}" = pa.id
      FROM "${p}" pa
      WHERE ch."${cuid}" IS NULL AND ch."${rf}" IS NOT NULL
        AND pa."${pc}" = ch."${rf}" AND pa."organizationId" = ch."organizationId";`);
    if (n > 0) console.log(`  ${c}.${cuid}: ${n} filled`);
    total += n;
  }
  console.log(`  total 2a fills: ${total}`);
}

async function step2b() {
  console.log("=== Step 2b: synthetic-id resolver (collision-aware) ===");
  const jobs = await prisma.$queryRawUnsafe(`SELECT id, "organizationId", "clientId" FROM "Job";`);
  const jobBySynthetic = new Map(jobs.map((j) => [syntheticIdFromCuid(j.id), j]));

  let applied = 0, held = 0;
  for (const tbl of ["Placement", "Interview"]) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, "organizationId", "candidateId", "jobRfId", "clientRfId", "clientId" FROM "${tbl}" WHERE "jobId" IS NULL AND "jobRfId" < 0;`);
    for (const t of rows) {
      const job = jobBySynthetic.get(Number(t.jobRfId));
      if (!job || job.organizationId !== t.organizationId) { console.log(`  SKIP unresolved ${tbl} ${t.id}`); continue; }
      // Placement unique (candidateId, jobId): hold duplicates for manual reconciliation.
      if (tbl === "Placement") {
        const [dup] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "Placement" WHERE "candidateId"=$1 AND "jobId"=$2 AND id<>$3 LIMIT 1;`, t.candidateId, job.id, t.id);
        if (dup) { console.log(`  HELD ${tbl} ${t.id} (duplicate of ${dup.id} — reconcile manually)`); held++; continue; }
      }
      const deriveClient = !t.clientId && Number(t.clientRfId) === 0 ? job.clientId : null;
      if (deriveClient) {
        await prisma.$executeRawUnsafe(
          `UPDATE "${tbl}" SET "jobId"=$1,"clientId"=$2,"jobRfId"=NULL,"clientRfId"=NULL WHERE id=$3 AND "jobId" IS NULL AND "clientId" IS NULL;`,
          job.id, deriveClient, t.id);
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE "${tbl}" SET "jobId"=$1,"jobRfId"=NULL WHERE id=$2 AND "jobId" IS NULL;`, job.id, t.id);
      }
      applied++;
    }
  }
  console.log(`  2b applied: ${applied}, held(duplicates): ${held}`);
}

(async () => {
  await step2a();
  await step2b();
  console.log("Phase B backfill complete.");
  await prisma.$disconnect();
})().catch(async (e) => { console.error("ERROR:", e.message); await prisma.$disconnect(); process.exit(1); });
