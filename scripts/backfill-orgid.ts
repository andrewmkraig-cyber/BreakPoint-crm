// Phase 5: one-shot orgId backfill. Ran once during Phase 5 to stamp
// the default BreakPoint Talent org on every NULL organizationId row
// across 12 tenant tables, so the subsequent NOT NULL schema flip
// didn't hit a constraint violation.
//
// Historical results (from the 2026-04-24 run):
//   ActionLog              0
//   Candidate              0
//   CandidateResume        0
//   Client                 0
//   ClientAgreement        0
//   ClientBenefits         0
//   ClientBenefitsFile     0
//   Contact                0
//   Interview              0
//   Job                    0
//   JobOverride            0
//   Placement              2
//   TOTAL                  2
//
// Post-flip this script can't execute — Prisma's generated types
// reject `where: { organizationId: null }` because the column is no
// longer nullable. Kept in the tree as documentation of the migration
// step. Delete in Phase 6 if no longer valuable.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  console.log("Phase 5 orgId backfill is historical — organizationId is NOT NULL on every tenant table.");
  console.log("Default org:", org);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
