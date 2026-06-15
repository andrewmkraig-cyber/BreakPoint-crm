// Idempotent seed for the self-serve Apollo sequence mappings (BdSequence).
//
// Seeds the two known sequences for the BreakPoint Talent org so the table is
// populated out of the gate (nothing falls back to the hardcoded list) and
// Andrew's new "Great Neck BD" sequence is immediately selectable:
//   - "Tax BD Sequence"  apollo 6a06068f8142ee001d2b3dd2  -> Public Accounting
//   - "Great Neck BD"    apollo 6a3057feaed6610020449ca9  -> Public Accounting
//
// Upserts on the (organizationId, apolloSequenceId) unique key, so re-running
// is safe — it updates name/vertical/active rather than duplicating. The
// vertical is resolved by name (case-insensitive); if Public Accounting is not
// found the mapping is still seeded with a null vertical (selectable, unmapped)
// and a warning is printed.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/seed-bd-sequences.ts            # dry run, prints what it would do
//   npx tsx scripts/seed-bd-sequences.ts --apply    # write
//   npx tsx scripts/seed-bd-sequences.ts --org=<cuid> --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc";
const VERTICAL_NAME = "Public Accounting";

const SEEDS = [
  { name: "Tax BD Sequence", apolloSequenceId: "6a06068f8142ee001d2b3dd2" },
  { name: "Great Neck BD", apolloSequenceId: "6a3057feaed6610020449ca9" },
];

function parseArgs(argv: string[]): { orgId: string; apply: boolean } {
  let orgId = DEFAULT_ORG_ID;
  let apply = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
  }
  return { orgId, apply };
}

async function main(): Promise<void> {
  const { orgId, apply } = parseArgs(process.argv);
  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} — org ${orgId}\n`);

  const vertical = await prisma.vertical.findFirst({
    where: { organizationId: orgId, name: { equals: VERTICAL_NAME, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!vertical) {
    console.warn(
      `WARNING: no "${VERTICAL_NAME}" vertical found for org ${orgId}. Seeding mappings with a null vertical.`,
    );
  } else {
    console.log(`Resolved vertical "${vertical.name}" -> ${vertical.id}`);
  }
  const verticalId = vertical?.id ?? null;

  for (const seed of SEEDS) {
    const existing = await prisma.bdSequence.findUnique({
      where: {
        organizationId_apolloSequenceId: { organizationId: orgId, apolloSequenceId: seed.apolloSequenceId },
      },
      select: { id: true, name: true, verticalId: true, active: true },
    });
    console.log(
      `  ${existing ? "UPDATE" : "CREATE"}  "${seed.name}"  apollo=${seed.apolloSequenceId}  vertical=${verticalId ?? "none"}` +
        (existing ? `  (was "${existing.name}")` : ""),
    );
    if (!apply) continue;
    await prisma.bdSequence.upsert({
      where: {
        organizationId_apolloSequenceId: { organizationId: orgId, apolloSequenceId: seed.apolloSequenceId },
      },
      create: { organizationId: orgId, name: seed.name, apolloSequenceId: seed.apolloSequenceId, verticalId, active: true },
      update: { name: seed.name, verticalId, active: true },
    });
  }

  console.log(apply ? "\nDone." : "\nDry run — no changes written. Re-run with --apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
