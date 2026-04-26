// One-shot: clear the tags array on every Candidate row. RF-imported
// tags are no longer used in any active query path; resetting them
// removes display noise from the candidate profile.
//
// Schema state: Candidate.tags is `String[] @default([])` — non-null,
// so `null` isn't a valid write. We use an empty array.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/clear-candidate-tags.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.candidate.updateMany({
    where: { tags: { isEmpty: false } },
    data: { tags: [] },
  });
  console.log(`Updated ${result.count} candidates`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
