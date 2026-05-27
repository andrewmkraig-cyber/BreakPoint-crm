// One-shot backfill: stamp Placement.clientId on rows where it's null
// but clientRfId is set, by joining clientRfId → Client.legacyRfId
// within the same organizationId.
//
// Why this is needed: RF-imported jobs were surfaced through
// getRfJobsForOrg without an _aceClientId hint (the loader only stamped
// it when Client.legacyRfId == null), so Apply / Submit wrote
// Placement.clientId = null even when a real Client cuid existed for
// that legacyRfId. The loader fix in src/lib/candidates.ts handles new
// writes; this script reconciles the existing null-clientId rows.
//
// Idempotent — only touches rows where clientId IS NULL. Tenant-scoped:
// the Client lookup uses both legacyRfId AND organizationId so an RF id
// collision across orgs (theoretical, but the schema permits it) can't
// mis-stamp. Logs unmatched rows so they can be reviewed manually
// rather than silently skipped.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/backfill-placement-clientid.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Unmatched = {
  placementId: string;
  organizationId: string;
  clientRfId: number;
};

async function main(): Promise<void> {
  const candidates = await prisma.placement.findMany({
    where: {
      clientId: null,
      clientRfId: { not: null },
    },
    select: {
      id: true,
      clientRfId: true,
      organizationId: true,
    },
  });

  console.log(
    `Found ${candidates.length} Placement row(s) with clientId = null AND clientRfId IS NOT NULL.`,
  );

  let updated = 0;
  const unmatched: Unmatched[] = [];

  for (const p of candidates) {
    if (p.clientRfId == null) continue; // narrow for TS — already filtered by where
    const client = await prisma.client.findFirst({
      where: {
        legacyRfId: p.clientRfId,
        organizationId: p.organizationId,
      },
      select: { id: true },
    });
    if (!client) {
      unmatched.push({
        placementId: p.id,
        organizationId: p.organizationId,
        clientRfId: p.clientRfId,
      });
      continue;
    }
    await prisma.placement.update({
      where: { id: p.id },
      data: { clientId: client.id },
    });
    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} of ${candidates.length}.`);
  if (unmatched.length > 0) {
    console.log(`Unmatched (${unmatched.length}) — no Client row with legacyRfId in the same org:`);
    for (const row of unmatched) {
      console.log(
        `  placementId=${row.placementId}  orgId=${row.organizationId}  clientRfId=${row.clientRfId}`,
      );
    }
  } else {
    console.log("All candidate rows resolved to a Client.");
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
