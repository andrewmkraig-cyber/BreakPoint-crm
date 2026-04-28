// One-shot migration: rename legacy EmailTemplate.trigger values to the
// post-26.0 trigger taxonomy. Idempotent — running twice is a no-op
// because each UPDATE only matches the OLD key.
//
// Run via:  npx tsx scripts/migrate-trigger-keys.ts
//
// Renames:
//   client_interview_confirmation  → client_interview_scheduled
//   interview_confirmation         → candidate_interview_prep
//
// All other keys keep their current values. CLIENT_SUBMITTAL stays as
// the composer body source (not a real trigger; just hidden from the
// picker). New keys (candidate_applied_confirmation, offer_extended,
// candidate_hired_welcome) are seeded via ensureDefaultTemplates on
// next request — nothing to migrate for those.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const renames: Array<{ from: string; to: string }> = [
    { from: "client_interview_confirmation", to: "client_interview_scheduled" },
    { from: "interview_confirmation", to: "candidate_interview_prep" },
  ];

  for (const r of renames) {
    const result = await prisma.emailTemplate.updateMany({
      where: { trigger: r.from },
      data: { trigger: r.to },
    });
    console.log(
      `[trigger-rename] ${r.from} → ${r.to}: updated ${result.count} row(s)`,
    );
  }

  // Collision cleanup: the rename above can produce TWO rows with
  // trigger=candidate_interview_prep — the original prep template
  // (richer body, name "Candidate Interview Prep" / "Interview
  // Scheduled — Candidate Prep") AND the renamed legacy ("Interview
  // Confirmation" / "Interview Confirmation (legacy)"). loadTriggeredTemplate
  // does findFirst orderBy updatedAt desc, so the legacy row would
  // win — and since the legacy body is strictly less useful than
  // the prep template, just delete it outright. Idempotent: a
  // second run finds 0 matches.
  const legacyDelete = await prisma.emailTemplate.deleteMany({
    where: {
      trigger: "candidate_interview_prep",
      name: { in: ["Interview Confirmation", "Interview Confirmation (legacy)"] },
    },
  });
  console.log(
    `[trigger-rename] deleted legacy interview-confirmation row(s): ${legacyDelete.count}`,
  );

  // Sanity dump of the post-migration state so the operator can eyeball
  // any rows still pointing at unknown trigger keys.
  const all = await prisma.emailTemplate.findMany({
    select: { id: true, name: true, trigger: true, isActive: true },
    orderBy: { updatedAt: "asc" },
  });
  const byTrigger = new Map<string, number>();
  for (const t of all) {
    const key = t.trigger ?? "(null)";
    byTrigger.set(key, (byTrigger.get(key) ?? 0) + 1);
  }
  console.log("\n[trigger-rename] post-migration trigger distribution:");
  for (const [k, v] of Array.from(byTrigger.entries()).sort()) {
    console.log(`  ${k}: ${v}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
