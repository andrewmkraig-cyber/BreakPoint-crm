// One-shot cleanup: strip ", United States" suffixes and abbreviate
// full state names ("Boston, Massachusetts" → "Boston, MA") in
// Candidate.location across the whole DB. Run once after the display
// formatter went live so the stored data matches what users see.
//
// Idempotent: only writes rows whose formatted output differs from the
// stored value. Safe to re-run.
//
// Usage: from repo root,
//   set -a && source .env.local && set +a
//   npx tsx scripts/clean-candidate-locations.ts

import { PrismaClient } from "@prisma/client";
import { formatLocation } from "../src/lib/utils";

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.candidate.findMany({
    where: { location: { not: null } },
    select: { id: true, location: true },
  });

  let scanned = 0;
  let updated = 0;
  const samples: { id: string; before: string; after: string }[] = [];

  for (const c of candidates) {
    if (!c.location) continue;
    scanned++;
    const next = formatLocation(c.location);
    if (next && next !== c.location) {
      await prisma.candidate.update({
        where: { id: c.id },
        data: { location: next },
      });
      updated++;
      if (samples.length < 5) {
        samples.push({ id: c.id, before: c.location, after: next });
      }
    }
  }

  console.log(`Scanned: ${scanned}`);
  console.log(`Updated: ${updated}`);
  if (samples.length > 0) {
    console.log("Sample rewrites:");
    for (const s of samples) {
      console.log(`  ${s.id}: "${s.before}" → "${s.after}"`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
