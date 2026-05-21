// One-shot backfill for per-user client ownership (Step 1).
//
// Stamps Andrew as the owner of every existing client that has no owner
// yet. New clients are stamped with their creator at create time; this
// catches everything that predates the feature. Idempotent: only touches
// rows where ownerId IS NULL, so it is safe to re-run.
//
// Run (after `prisma db push` has added the ownerId column):
//   set -a; source .env.local; set +a; npx tsx scripts/backfill-client-owners.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OWNER_EMAIL = "andrew@breakpointtalent.com";

async function main() {
  const owner = await prisma.user.findFirst({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true },
  });
  if (!owner) {
    throw new Error(`No user found for ${OWNER_EMAIL} - aborting, no rows changed.`);
  }

  const unowned = await prisma.client.count({ where: { ownerId: null } });
  const res = await prisma.client.updateMany({
    where: { ownerId: null },
    data: { ownerId: owner.id },
  });

  console.log(`Owner:                 ${owner.email} (${owner.id})`);
  console.log(`Clients without owner: ${unowned}`);
  console.log(`Clients updated:       ${res.count}`);
  console.log("Done.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
