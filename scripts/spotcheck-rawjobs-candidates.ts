// READ-ONLY spot-check: show what job pills the "raw.jobs only, no Neon
// placement" legacy candidates display today. For a sample of them, prints
// each linked job (title + client + the historical RF stage from the
// payload) and notes that the live renderer flattens the badge to SOURCED
// because there is no Neon placement. Also flags whether the job still
// exists as a Neon Job. No writes.
//   node_modules/.bin/tsx scripts/spotcheck-rawjobs-candidates.ts [sampleSize]
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

type RawJob = {
  job_id?: number;
  title?: string;
  name?: string;
  client_company_name?: string | null;
  stage_name?: string | null;
  is_open?: boolean;
  added_time?: string | null;
  disqualification_reason?: string | null;
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const sampleSize = Number(process.argv[2] ?? 8);

  const legacy = await prisma.candidate.findMany({
    where: { rfId: { not: null } },
    select: { id: true, rfId: true, firstName: true, lastName: true, raw: true },
  });

  // Resolve which legacy candidates are "raw.jobs only, no Neon placement".
  const sample: typeof legacy = [];
  for (const c of legacy) {
    const raw = c.raw as Record<string, unknown> | null;
    const jobs = Array.isArray(raw?.["jobs"]) ? (raw!["jobs"] as RawJob[]) : [];
    if (jobs.length === 0) continue;
    const byCuid = await prisma.placement.count({ where: { candidateId: c.id } });
    const byRf = c.rfId != null ? await prisma.placement.count({ where: { candidateRfId: c.rfId } }) : 0;
    if (byCuid === 0 && byRf === 0) {
      sample.push(c);
      if (sample.length >= sampleSize) break;
    }
  }

  // Map job_id -> still-exists-in-Neon (by legacyRfId).
  const allJobIds = new Set<number>();
  for (const c of sample) {
    const jobs = ((c.raw as Record<string, unknown>)["jobs"] as RawJob[]) ?? [];
    for (const j of jobs) if (typeof j.job_id === "number") allJobIds.add(j.job_id);
  }
  const liveJobs = await prisma.job.findMany({
    where: { legacyRfId: { in: Array.from(allJobIds) } },
    select: { legacyRfId: true, title: true, isOpen: true },
  });
  const liveJobByRf = new Map<number, { title: string; isOpen: boolean }>();
  for (const j of liveJobs) if (j.legacyRfId != null) liveJobByRf.set(j.legacyRfId, { title: j.title, isOpen: j.isOpen });

  console.log(`Spot-check of ${sample.length} legacy candidates whose pills come only from raw.jobs[] (no Neon placement).`);
  console.log("Renderer note: with no Neon placement, every pill below shows the SOURCED badge regardless of the historical RF stage.\n");

  for (const c of sample) {
    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(unnamed)";
    const jobs = ((c.raw as Record<string, unknown>)["jobs"] as RawJob[]) ?? [];
    console.log(`================ ${name}  (rfId=${c.rfId})  ${jobs.length} linked job(s) ================`);
    for (const j of jobs) {
      const title = j.title || j.name || "(untitled job)";
      const client = j.client_company_name || "(no client)";
      const histStage = j.stage_name || "(no stage)";
      const live = typeof j.job_id === "number" ? liveJobByRf.get(j.job_id) : undefined;
      const liveNote = live ? `Neon job exists${live.isOpen ? "" : " (closed)"}` : "NOT in Neon jobs";
      const dq = j.disqualification_reason ? ` | DQ: ${j.disqualification_reason}` : "";
      console.log(`   - ${title}  ·  ${client}`);
      console.log(`       historical RF stage: ${histStage}  ->  renders as: SOURCED   [${liveNote}]${dq}`);
    }
    console.log("");
  }

  // Distribution of historical stages across ALL 594 (not just the sample),
  // so we know whether these are mostly dead "sourced" links or real
  // mid/late-pipeline history.
  const stageTally: Record<string, number> = {};
  let jobsTotal = 0;
  for (const c of legacy) {
    const raw = c.raw as Record<string, unknown> | null;
    const jobs = Array.isArray(raw?.["jobs"]) ? (raw!["jobs"] as RawJob[]) : [];
    if (jobs.length === 0) continue;
    const byCuid = await prisma.placement.count({ where: { candidateId: c.id } });
    const byRf = c.rfId != null ? await prisma.placement.count({ where: { candidateRfId: c.rfId } }) : 0;
    if (byCuid !== 0 || byRf !== 0) continue;
    for (const j of jobs) {
      jobsTotal++;
      const s = (j.stage_name || "(none)").trim();
      stageTally[s] = (stageTally[s] ?? 0) + 1;
    }
  }
  console.log("======== Historical RF stage_name distribution across all raw.jobs-only candidates ========");
  console.log(`(${jobsTotal} linked-job rows total)`);
  for (const [s, n] of Object.entries(stageTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${s}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
