// One-shot rename of the SavedSearch named
// "Public Accounting - Tax Partners - Ohio" to
// "Public Accounting - Nationwide". Idempotent — updateMany returns
// count=0 if the new name is already in place.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/rename-public-accounting-savedsearch.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.savedSearch.updateMany({
    where: { name: "Public Accounting - Tax Partners - Ohio" },
    data: { name: "Public Accounting - Nationwide" },
  });
  console.log(`Renamed ${result.count} saved search row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
