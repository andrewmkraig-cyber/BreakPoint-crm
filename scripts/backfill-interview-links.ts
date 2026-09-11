/**
 * Backfill Interview.jobId / Interview.clientId.
 *
 * scheduleInterview used to persist ONLY the legacy numeric ids. For
 * Ace-native rows those are a synthetic djb2 negative (job) and 0
 * (client), which match nothing in the DB, so the interview had no
 * usable pointer back to its Job or Client. Everything that reads
 * through those FKs degraded silently: interview prep wrote "we don't
 * have a job description on file" with the description sitting right
 * there, the [Job Description] merge field resolved to "", and the
 * clients-list live-interview rollup never counted the row.
 *
 * The forward fix is in interview-actions.ts (the cuids are written at
 * schedule time now). This repairs the rows already on the books.
 *
 * Resolution order per interview, most to least certain:
 *   1. jobRfId > 0            → Job.legacyRfId (a real RF job)
 *   2. jobRfId < 0            → the Job whose syntheticIdFromCuid(id)
 *                               equals it. djb2 is one-way, so we forward-
 *                               map every Job in the org and look the
 *                               interview's id up in that table. Exact.
 *   3. no job id at all       → the candidate's placements, but ONLY when
 *                               they all point at one job. Ambiguous
 *                               candidates are skipped, never guessed.
 * The client then comes from clientRfId > 0, else the synthetic map, else
 * the resolved Job's own clientId.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-interview-links.ts
 *   npx tsx scripts/backfill-interview-links.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";

// Inlined rather than imported from lib/candidates: that module pulls in
// getCurrentOrg, which reaches for React's request cache and blows up
// outside a request. This is the same djb2 the app uses.
function syntheticIdFromCuid(cuid: string): number {
  let hash = 5381;
  for (let i = 0; i < cuid.length; i++) {
    hash = ((hash << 5) + hash + cuid.charCodeAt(i)) >>> 0;
  }
  return -((hash & 0x7fffffff) || 1);
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const [jobs, clients] = await Promise.all([
    prisma.job.findMany({
      select: { id: true, organizationId: true, legacyRfId: true, clientId: true, title: true },
    }),
    prisma.client.findMany({
      select: { id: true, organizationId: true, legacyRfId: true, name: true },
    }),
  ]);

  const jobBySynthetic = new Map<string, (typeof jobs)[number]>();
  const jobByLegacy = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    jobBySynthetic.set(`${job.organizationId}:${syntheticIdFromCuid(job.id)}`, job);
    if (job.legacyRfId != null) jobByLegacy.set(`${job.organizationId}:${job.legacyRfId}`, job);
  }
  const clientBySynthetic = new Map<string, (typeof clients)[number]>();
  const clientByLegacy = new Map<string, (typeof clients)[number]>();
  const clientById = new Map<string, (typeof clients)[number]>();
  for (const client of clients) {
    clientBySynthetic.set(`${client.organizationId}:${syntheticIdFromCuid(client.id)}`, client);
    if (client.legacyRfId != null) clientByLegacy.set(`${client.organizationId}:${client.legacyRfId}`, client);
    clientById.set(client.id, client);
  }

  const interviews = await prisma.interview.findMany({
    where: { OR: [{ jobId: null }, { clientId: null }] },
    select: {
      id: true,
      organizationId: true,
      candidateId: true,
      candidateRfId: true,
      jobId: true,
      jobRfId: true,
      clientId: true,
      clientRfId: true,
      scheduledAt: true,
      status: true,
    },
    orderBy: { scheduledAt: "asc" },
  });

  let jobFixed = 0;
  let clientFixed = 0;
  let skipped = 0;
  const bySource = { legacy: 0, synthetic: 0, placement: 0 };

  for (const iv of interviews) {
    let job = iv.jobId ? jobs.find((j) => j.id === iv.jobId) ?? null : null;
    let source: keyof typeof bySource | null = null;

    if (!job && iv.jobRfId != null && iv.jobRfId > 0) {
      job = jobByLegacy.get(`${iv.organizationId}:${iv.jobRfId}`) ?? null;
      if (job) source = "legacy";
    }
    if (!job && iv.jobRfId != null && iv.jobRfId < 0) {
      job = jobBySynthetic.get(`${iv.organizationId}:${iv.jobRfId}`) ?? null;
      if (job) source = "synthetic";
    }
    if (!job) {
      // Placement fallback, and only when it is unambiguous.
      const where = iv.candidateId
        ? { candidateId: iv.candidateId }
        : iv.candidateRfId != null
          ? { candidateRfId: iv.candidateRfId }
          : null;
      if (where) {
        const placements = await prisma.placement.findMany({
          where: { organizationId: iv.organizationId, jobId: { not: null }, ...where },
          select: { jobId: true },
        });
        const distinct = Array.from(new Set(placements.map((p) => p.jobId!)));
        if (distinct.length === 1) {
          job = jobs.find((j) => j.id === distinct[0]) ?? null;
          if (job) source = "placement";
        }
      }
    }

    let client = iv.clientId ? clientById.get(iv.clientId) ?? null : null;
    if (!client && iv.clientRfId != null && iv.clientRfId > 0) {
      client = clientByLegacy.get(`${iv.organizationId}:${iv.clientRfId}`) ?? null;
    }
    if (!client && iv.clientRfId != null && iv.clientRfId < 0) {
      client = clientBySynthetic.get(`${iv.organizationId}:${iv.clientRfId}`) ?? null;
    }
    if (!client && job?.clientId) client = clientById.get(job.clientId) ?? null;
    // Never write a cross-tenant pointer.
    if (client && client.organizationId !== iv.organizationId) client = null;
    if (job && job.organizationId !== iv.organizationId) job = null;

    const data: { jobId?: string; clientId?: string } = {};
    if (!iv.jobId && job) data.jobId = job.id;
    if (!iv.clientId && client) data.clientId = client.id;

    if (Object.keys(data).length === 0) {
      skipped += 1;
      console.log(
        `SKIP  ${iv.id}  ${iv.scheduledAt.toISOString().slice(0, 10)}  jobRfId=${iv.jobRfId} clientRfId=${iv.clientRfId} (nothing resolvable)`,
      );
      continue;
    }

    if (data.jobId) {
      jobFixed += 1;
      if (source) bySource[source] += 1;
    }
    if (data.clientId) clientFixed += 1;

    console.log(
      `${APPLY ? "FIX  " : "WOULD"} ${iv.id}  ${iv.scheduledAt.toISOString().slice(0, 10)}  ` +
        `job=${job ? `${job.title} [${source ?? "already set"}]` : "-"}  client=${client?.name ?? "-"}`,
    );

    if (APPLY) {
      await prisma.interview.update({ where: { id: iv.id }, data });
    }
  }

  console.log("");
  console.log(`${APPLY ? "Applied" : "Dry run"}: ${interviews.length} interviews examined`);
  console.log(`  job linked:    ${jobFixed}  (legacy ${bySource.legacy}, synthetic ${bySource.synthetic}, placement ${bySource.placement})`);
  console.log(`  client linked: ${clientFixed}`);
  console.log(`  unresolvable:  ${skipped}`);
  if (!APPLY) console.log("\nRe-run with --apply to write.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
