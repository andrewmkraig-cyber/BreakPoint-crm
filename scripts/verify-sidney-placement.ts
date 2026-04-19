import { prisma } from "../src/lib/prisma";

async function main() {
  const row = await prisma.placement.findFirst({
    where: { candidateRfId: 867, jobRfId: 10 },
    select: {
      id: true,
      candidateRfId: true,
      jobRfId: true,
      clientRfId: true,
      stage: true,
      createdAt: true,
      updatedAt: true,
      syncedToRf: true,
    },
  });
  console.log("Sidney (867) ↔ Tax Manager (10):", row);

  const submittedCount = await prisma.placement.count({ where: { stage: "submitted" } });
  console.log("Total placements at stage=submitted:", submittedCount);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
