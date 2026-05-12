// One-shot cleanup: removes the legacy /jobs/-309396680 row that was
// created with a negative legacyRfId (an artifact of an earlier
// create-job path that synthesized a sentinel rather than leaving the
// column null). Run with:
//
//   npx tsx scripts/delete-corrupt-negative-rfid-job.ts
//
// Idempotent — re-runs are no-ops once the row is gone.

import { prisma } from "../src/lib/prisma";

async function main() {
  const candidates = await prisma.job.findMany({
    where: { legacyRfId: { lt: 0 } },
    select: {
      id: true,
      legacyRfId: true,
      title: true,
      organizationId: true,
      createdAt: true,
    },
  });
  if (candidates.length === 0) {
    console.log("No jobs with negative legacyRfId found. Nothing to delete.");
    return;
  }
  for (const j of candidates) {
    console.log(
      `Deleting job id=${j.id} legacyRfId=${j.legacyRfId} title=${JSON.stringify(j.title)} createdAt=${j.createdAt.toISOString()}`,
    );
    await prisma.job.delete({ where: { id: j.id } });
  }
  console.log(`Deleted ${candidates.length} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
