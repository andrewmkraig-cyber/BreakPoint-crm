// One-off migration: move Miles Atchison (RF candidate 75) from Hired to
// Pending Start with an expected start date of 2026-05-04.
//
// Run once with:
//   npx tsx scripts/migrate-miles-pending-start.ts
//
// Safe to re-run — uses upsert.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const CANDIDATE_RF_ID = 75;
  const JOB_RF_ID = 7;
  const CLIENT_RF_ID = 20;
  const START = new Date("2026-05-04T00:00:00.000Z");

  const user = await prisma.user.findFirst({ where: { email: "andrew@breakpointtalent.com" }, select: { id: true } });
  if (!user) throw new Error("andrew@breakpointtalent.com user not found — sign in once first.");

  const result = await prisma.placement.upsert({
    where: { candidateRfId_jobRfId: { candidateRfId: CANDIDATE_RF_ID, jobRfId: JOB_RF_ID } },
    create: {
      candidateRfId: CANDIDATE_RF_ID,
      jobRfId: JOB_RF_ID,
      clientRfId: CLIENT_RF_ID,
      stage: "pending_start",
      placedAt: new Date(),
      expectedStartDate: START,
      placementNotes: "Moved from Hired to Pending Start — 2026-04-16 backfill.",
      createdById: user.id,
    },
    update: {
      stage: "pending_start",
      expectedStartDate: START,
      startConfirmedAt: null,
      startConfirmationFile: null,
      startConfirmationMime: null,
      invoicingFlagged: false,
      invoicedAt: null,
    },
    select: { id: true, stage: true, expectedStartDate: true },
  });

  console.log("Miles placement after migration:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
