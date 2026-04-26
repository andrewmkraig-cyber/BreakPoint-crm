// One-shot: clear `tags` and `attributes` from every Candidate.raw
// JSON blob. The candidate profile renderer reads RF-imported tag/
// attribute lists out of `raw` (Candidate.raw is the original RF
// payload stashed at import time) — clearing the String[] `tags`
// column alone leaves the visible chips intact.
//
// Sets both keys to empty arrays rather than deleting them, so any
// other reader sees an iterable empty list instead of `undefined`.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/clear-candidate-raw-tags.ts

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.candidate.findMany({
    where: { raw: { not: Prisma.JsonNull } },
    select: { id: true, raw: true },
  });

  let scanned = 0;
  let updated = 0;
  for (const c of candidates) {
    if (!c.raw || typeof c.raw !== "object" || Array.isArray(c.raw)) continue;
    scanned++;
    const raw = c.raw as Record<string, unknown>;
    const hasTags = Array.isArray(raw.tags) && raw.tags.length > 0;
    const hasAttrs = Array.isArray(raw.attributes) && raw.attributes.length > 0;
    if (!hasTags && !hasAttrs) continue;
    const next: Record<string, unknown> = { ...raw, tags: [], attributes: [] };
    await prisma.candidate.update({
      where: { id: c.id },
      data: { raw: next as Prisma.InputJsonValue },
    });
    updated++;
  }

  console.log(`Scanned: ${scanned} candidates with raw JSON`);
  console.log(`Updated: ${updated} (had non-empty raw.tags or raw.attributes)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
