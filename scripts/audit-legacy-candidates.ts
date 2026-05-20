// Phase 0 audit (READ-ONLY) for retiring the legacy candidate profile
// render path. Answers: how many candidates still route through the
// rfId-keyed branch, whether their display fields live in Neon columns or
// only in the imported `raw` blob, and - most importantly - whether their
// Placement rows are reachable by cuid (candidateId) the way
// LocalCandidateProfile reads them, or only by the numeric candidateRfId
// (in which case they would lose every job pill on cutover).
//
// Makes no writes. Run: node_modules/.bin/tsx scripts/audit-legacy-candidates.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

type Raw = Record<string, unknown> | null;

function rawHas(raw: Raw, key: string): boolean {
  if (!raw) return false;
  const v = raw[key];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function colHasStr(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");

  const total = await prisma.candidate.count();
  const legacy = await prisma.candidate.count({ where: { rfId: { not: null } } });
  const native = total - legacy;

  console.log("================ CANDIDATE COUNTS ================");
  console.log("Total candidates:        ", total);
  console.log("Legacy (rfId set):       ", legacy);
  console.log("Native (rfId null):      ", native);

  // ---- Placement keying (the cutover linchpin) ----
  const placTotal = await prisma.placement.count();
  const placWithCuid = await prisma.placement.count({ where: { candidateId: { not: null } } });
  const placCuidNull = await prisma.placement.count({ where: { candidateId: null } });
  const placRfNullCuidSet = await prisma.placement.count({
    where: { candidateRfId: null, candidateId: { not: null } },
  });

  console.log("\n================ PLACEMENT KEYING ================");
  console.log("Total placements:                    ", placTotal);
  console.log("Placements with candidateId (cuid):  ", placWithCuid);
  console.log("Placements with candidateId NULL:    ", placCuidNull, "(unreachable by LocalCandidateProfile)");
  console.log("Native-keyed (rfId null, cuid set):  ", placRfNullCuidSet);

  // ---- Per-legacy-candidate parity ----
  const legacyCands = await prisma.candidate.findMany({
    where: { rfId: { not: null } },
    select: {
      id: true,
      rfId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      linkedinProfile: true,
      skills: true,
      experience: true,
      education: true,
      expectedSalary: true,
      raw: true,
    },
  });

  // Display-field backfill gaps: Neon column empty but raw has a value.
  const fieldGaps: Record<string, number> = {};
  const bump = (k: string) => (fieldGaps[k] = (fieldGaps[k] ?? 0) + 1);
  let anyDisplayGap = 0;

  // Placement reachability per legacy candidate.
  let withCuidPlacements = 0; // pills survive
  let onlyRfPlacements = 0; // pills LOST on cutover (placements exist by rfId only)
  let rawJobsNoNeon = 0; // pills shown today from raw.jobs[] but no Neon placement at all
  let noPlacementsAtAll = 0;

  // Late-stage exposure (need full pipeline actions before cutover).
  const lateStages = new Set(["offer", "pending_start", "hired", "cancelled"]);
  let withLateStage = 0;

  const lostExamples: { id: string; rfId: number | null; name: string }[] = [];

  for (const c of legacyCands) {
    const raw = (c.raw as Raw) ?? null;
    let gapped = false;
    const checks: [string, boolean, boolean][] = [
      ["email", colHasStr(c.email), rawHas(raw, "email")],
      ["phone", colHasStr(c.phone), rawHas(raw, "phone_number")],
      ["currentDesignation", colHasStr(c.currentDesignation), rawHas(raw, "current_designation")],
      ["currentOrganization", colHasStr(c.currentOrganization), rawHas(raw, "current_organization")],
      ["location", colHasStr(c.location), rawHas(raw, "location")],
      ["linkedinProfile", colHasStr(c.linkedinProfile), rawHas(raw, "linkedin_profile")],
      ["skills", (c.skills?.length ?? 0) > 0, rawHas(raw, "skills")],
      ["experience", c.experience != null, rawHas(raw, "experience")],
      ["education", c.education != null, rawHas(raw, "education")],
      ["expectedSalary", c.expectedSalary != null, rawHas(raw, "expected_salary")],
    ];
    for (const [name, colOk, rawOk] of checks) {
      if (!colOk && rawOk) {
        bump(name);
        gapped = true;
      }
    }
    if (gapped) anyDisplayGap++;

    // Placement reachability for this candidate.
    const byCuid = await prisma.placement.count({ where: { candidateId: c.id } });
    const byRf = c.rfId != null ? await prisma.placement.count({ where: { candidateRfId: c.rfId } }) : 0;
    const rawJobs = Array.isArray((raw as Record<string, unknown>)?.["jobs"])
      ? ((raw as Record<string, unknown>)["jobs"] as unknown[]).length
      : 0;

    if (byCuid > 0) {
      withCuidPlacements++;
    } else if (byRf > 0) {
      onlyRfPlacements++;
      if (lostExamples.length < 15) lostExamples.push({ id: c.id, rfId: c.rfId, name: [c.firstName, c.lastName].filter(Boolean).join(" ") });
    } else if (rawJobs > 0) {
      rawJobsNoNeon++;
    } else {
      noPlacementsAtAll++;
    }

    // Late-stage exposure (check reachable rows by either key).
    const late = await prisma.placement.count({
      where: {
        OR: [{ candidateId: c.id }, ...(c.rfId != null ? [{ candidateRfId: c.rfId }] : [])],
        stage: { in: Array.from(lateStages) },
      },
    });
    if (late > 0) withLateStage++;
  }

  console.log("\n========== LEGACY DISPLAY-FIELD GAPS (Neon empty, raw has value) ==========");
  console.log("Legacy candidates with >=1 display gap:", anyDisplayGap, "of", legacy);
  for (const [k, n] of Object.entries(fieldGaps).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${n}`);
  }
  if (Object.keys(fieldGaps).length === 0) console.log("  (none - all display fields already in Neon columns)");

  console.log("\n========== LEGACY PLACEMENT (PILL) REACHABILITY ==========");
  console.log("Pills survive (placements by cuid):     ", withCuidPlacements);
  console.log("Pills LOST (placements only by rfId):   ", onlyRfPlacements, "<-- BLOCKER if > 0");
  console.log("Shown from raw.jobs, no Neon placement: ", rawJobsNoNeon);
  console.log("No placements at all:                   ", noPlacementsAtAll);
  console.log("Legacy candidates in offer/hired/pending/cancelled:", withLateStage, "(need full pipeline actions before cutover)");

  if (lostExamples.length > 0) {
    console.log("\n  Examples of candidates that would lose pills (rfId-only placements):");
    for (const e of lostExamples) console.log(`   - ${e.name} (id=${e.id}, rfId=${e.rfId})`);
  }

  console.log("\n================ VERDICT ================");
  const blocker = onlyRfPlacements > 0;
  console.log(blocker
    ? `BLOCKER: ${onlyRfPlacements} legacy candidate(s) have placements keyed only by rfId and would lose pills. Backfill candidateId on Placement is required before cutover.`
    : "No pill-loss blocker: all legacy placements are reachable by cuid.");
  console.log(anyDisplayGap > 0
    ? `Backfill needed: ${anyDisplayGap} legacy candidate(s) have display fields only in raw.`
    : "No display backfill needed: all legacy display fields are in Neon columns.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
