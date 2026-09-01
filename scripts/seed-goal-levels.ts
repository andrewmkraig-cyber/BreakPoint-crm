// Seeds the goals org chart on User.goalLevel / User.managerId.
//
// WHY THIS IS NEEDED. Both columns ship nullable with no backfill, and
// src/lib/goals/permissions.ts treats a null goalLevel as the MOST JUNIOR
// rank - deliberately, so an unseeded user is never handed authority by
// accident. The consequence is that until this runs, nobody can request or
// approve a company goal at all: canRequestCompanyGoal needs rank 0 or 1,
// and canApproveCompanyGoal needs rank 0. The Goals tab's create path
// throws and the approval queue can never render.
//
// The chart, matching the documented org (Andrew Kraig + Austin Barnard):
//   Andrew  goalLevel 0  - owner. Creates company goals ACTIVE, and is the
//                          only person who can approve someone else's.
//   Austin  goalLevel 1  - can REQUEST a company goal (it lands
//                          PENDING_APPROVAL) but cannot approve one, and
//                          reports to Andrew.
//
// These columns are read ONLY by the goals permissions helper. They are not
// auth: UserRole still decides what the app lets anyone do.
//
// Idempotent - it writes only when a value differs from the target, so a
// second --apply run reports no changes.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/seed-goal-levels.ts            # dry run
//   npx tsx scripts/seed-goal-levels.ts --apply    # write

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OWNER_EMAIL = "andrew@breakpointtalent.com";
const CHART: Array<{ email: string; goalLevel: number; managerEmail: string | null }> = [
  { email: OWNER_EMAIL, goalLevel: 0, managerEmail: null },
  { email: "austin@breakpointtalent.com", goalLevel: 1, managerEmail: OWNER_EMAIL },
];

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} - goals org chart\n`);

  const emails = Array.from(
    new Set(CHART.flatMap((c) => [c.email, c.managerEmail]).filter(Boolean) as string[]),
  );
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, goalLevel: true, managerId: true },
  });
  const byEmail = new Map(users.map((u) => [u.email ?? "", u]));

  let changed = 0;
  let unchanged = 0;

  for (const row of CHART) {
    const user = byEmail.get(row.email);
    if (!user) {
      console.log(`  SKIP      ${row.email} - no such user`);
      continue;
    }
    const managerId = row.managerEmail ? byEmail.get(row.managerEmail)?.id ?? null : null;
    if (row.managerEmail && !managerId) {
      console.log(`  SKIP      ${row.email} - manager ${row.managerEmail} not found`);
      continue;
    }

    const needsLevel = user.goalLevel !== row.goalLevel;
    const needsManager = user.managerId !== managerId;
    const label =
      `${row.email.padEnd(32)} goalLevel ${user.goalLevel ?? "null"} -> ${row.goalLevel}` +
      `   manager ${user.managerId ?? "null"} -> ${managerId ?? "null"}`;

    if (!needsLevel && !needsManager) {
      console.log(`  unchanged ${label}`);
      unchanged += 1;
      continue;
    }
    console.log(`  SET       ${label}`);
    changed += 1;
    if (apply) {
      await prisma.user.update({
        where: { id: user.id },
        data: { goalLevel: row.goalLevel, managerId },
      });
    }
  }

  console.log(
    `\n${apply ? "Wrote" : "Would write"}: ${changed} changed, ${unchanged} already correct.`,
  );
  if (!apply) console.log("Nothing was written. Re-run with --apply to write.\n");
  else console.log("Done. Re-running this script is a no-op.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
