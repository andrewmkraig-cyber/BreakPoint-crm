// One-shot backfill: promote Client.customFields → Client.feePct for
// every row where the typed column is null but the JSON customFields
// blob carries an "Avg Fee %" / "Fee %" / "Fee Percent" entry. RF-
// imported clients (Sheehan Brothers Vending, etc.) had their fee %
// landed only in customFields during the migration; the
// /candidates/[id] offer dialog reads Client.feePct so the field never
// auto-filled until this script runs.
//
// Reuses extractFeePctFromCustomFields from src/lib/clients.ts so the
// parse rules stay aligned with /jobs/[id] and the new defensive read
// at /candidates/[id]. Idempotent — only touches rows where feePct IS
// null. Tenant-scoped: organizationId is captured per row and logged so
// the live output stays auditable. Logs rows where customFields exists
// but no fee % name variant matched, so the recruiter can review those
// by hand if needed.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/backfill-client-feepct.ts

import { Prisma, PrismaClient } from "@prisma/client";
import { extractFeePctFromCustomFields } from "../src/lib/clients";

const prisma = new PrismaClient();

type Skipped = {
  clientId: string;
  organizationId: string;
  legacyRfId: number | null;
  name: string;
};

async function main(): Promise<void> {
  // Prisma.DbNull (not JsonNull) targets "the column is DB-NULL". We
  // want every row where customFields holds *any* value — array,
  // object, string, even JSON null — so the where filter is "not
  // DbNull". The downstream parser handles malformed shapes.
  const candidates = await prisma.client.findMany({
    where: {
      feePct: null,
      customFields: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      organizationId: true,
      legacyRfId: true,
      name: true,
      customFields: true,
    },
  });

  console.log(
    `Found ${candidates.length} Client row(s) with feePct = null AND customFields IS NOT NULL.`,
  );

  let updated = 0;
  const skipped: Skipped[] = [];

  for (const c of candidates) {
    const parsed = extractFeePctFromCustomFields(c.customFields);
    if (parsed == null) {
      skipped.push({
        clientId: c.id,
        organizationId: c.organizationId,
        legacyRfId: c.legacyRfId,
        name: c.name,
      });
      continue;
    }
    await prisma.client.update({
      where: { id: c.id },
      data: { feePct: parsed },
    });
    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} of ${candidates.length}.`);
  if (skipped.length > 0) {
    console.log(
      `Skipped ${skipped.length} row(s) — customFields present but no recognized fee % entry:`,
    );
    for (const s of skipped) {
      const rfTag = s.legacyRfId != null ? ` (rfId=${s.legacyRfId})` : "";
      console.log(`  ${s.name}${rfTag}  orgId=${s.organizationId}  clientId=${s.clientId}`);
    }
  } else {
    console.log("Every candidate row had a parseable fee % entry.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
