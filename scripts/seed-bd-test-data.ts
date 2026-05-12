// One-shot seed for BD Phase 1 verification. Creates the rows the
// /bd/launch page needs to render a real Launch flow:
//   - 1 Vertical (Public Accounting)
//   - 1 SavedSearch under it (Tax Partners, Ohio)
//   - 5 SendingDomain rows in HEALTHY rotation
//
// Idempotent: re-running against the same DB upserts every row by its
// natural-key shape, so it never duplicates. Safe to run repeatedly
// during BD development.
//
// Usage:
//   set -a; source .env.local; set +a; npx tsx scripts/seed-bd-test-data.ts

import { prisma } from "../src/lib/prisma";

const ORGANIZATION_ID = "cmobj8dxz00012gliequ53kvc";

const VERTICAL_NAME = "Public Accounting";
const VERTICAL_SLUG = "public-accounting";

const SAVED_SEARCH_NAME = "Public Accounting - Tax Partners - Ohio";
const SAVED_SEARCH_DAILY_CAP = 80;

// The Phase 1 schema collapses every BD search field into a single
// `criteria` Json blob on SavedSearch — apolloSequenceId, targetTitles,
// locations, companySizeMin/Max, keywords, minFreshnessDays all live
// here. The morning cron (BD Phase 3+) will read this blob to drive
// Indeed scan + Apollo enrich + Apollo sequence enrollment.
const SAVED_SEARCH_CRITERIA = {
  apolloSequenceId: "placeholder-sequence-id",
  targetTitles: ["Tax Manager", "Tax Partner", "Senior Tax Manager"],
  locations: [{ city: "Cleveland", state: "OH", radiusMiles: 50 }],
  companySizeMin: 10,
  companySizeMax: 500,
  keywords: "tax AND (manager OR partner)",
  minFreshnessDays: 7,
};

const SENDING_DOMAINS = [
  "outreach1.breakpointconnect.com",
  "outreach2.breakpointconnect.com",
  "outreach3.breakpointconnect.com",
  "outreach4.breakpointconnect.com",
  "outreach5.breakpointconnect.com",
];

async function main(): Promise<void> {
  console.log("\n=== BD test data seed ===\n");

  const org = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`Organization ${ORGANIZATION_ID} not found`);
  console.log(`Org: ${org.name} (${org.id})`);

  // 1) Vertical — natural key is (organizationId, slug).
  const vertical = await prisma.vertical.upsert({
    where: {
      organizationId_slug: { organizationId: org.id, slug: VERTICAL_SLUG },
    },
    create: {
      organizationId: org.id,
      name: VERTICAL_NAME,
      slug: VERTICAL_SLUG,
    },
    update: {
      name: VERTICAL_NAME,
    },
    select: { id: true, name: true, slug: true },
  });
  console.log(`Vertical: ${vertical.name} (${vertical.id})`);

  // 2) SavedSearch — no natural unique on the schema; match by
  //    (organizationId, verticalId, name) so a re-run upserts.
  const existingSearch = await prisma.savedSearch.findFirst({
    where: {
      organizationId: org.id,
      verticalId: vertical.id,
      name: SAVED_SEARCH_NAME,
    },
    select: { id: true },
  });
  const savedSearch = existingSearch
    ? await prisma.savedSearch.update({
        where: { id: existingSearch.id },
        data: {
          criteria: SAVED_SEARCH_CRITERIA,
          contactCap: SAVED_SEARCH_DAILY_CAP,
          active: true,
        },
        select: { id: true, name: true },
      })
    : await prisma.savedSearch.create({
        data: {
          organizationId: org.id,
          verticalId: vertical.id,
          name: SAVED_SEARCH_NAME,
          criteria: SAVED_SEARCH_CRITERIA,
          contactCap: SAVED_SEARCH_DAILY_CAP,
        },
        select: { id: true, name: true },
      });
  console.log(`SavedSearch: ${savedSearch.name} (${savedSearch.id})`);

  // 3) SendingDomains — stagger lastUsedAt so the API route's
  //    `orderBy: lastUsedAt asc` puts priority 1 first in the rotation
  //    pool (oldest = next in line under round-robin). Without this the
  //    preview chip's dot order would be effectively random.
  const now = Date.now();
  for (let i = 0; i < SENDING_DOMAINS.length; i++) {
    const domain = SENDING_DOMAINS[i];
    // Priority i+1 → lastUsedAt (5 - i) hours ago. So outreach1 is the
    // oldest (5h ago, picked first); outreach5 is the newest (1h ago).
    const lastUsedAt = new Date(now - (SENDING_DOMAINS.length - i) * 60 * 60 * 1000);
    const result = await prisma.sendingDomain.upsert({
      where: {
        organizationId_domain: { organizationId: org.id, domain },
      },
      create: {
        organizationId: org.id,
        domain,
        status: "HEALTHY",
        dailyCap: 20,
        lastUsedAt,
      },
      update: {
        status: "HEALTHY",
        dailyCap: 20,
        lastUsedAt,
      },
      select: { id: true, domain: true, status: true },
    });
    console.log(`SendingDomain: ${result.domain} (${result.status})`);
  }

  console.log("\n✅ Seed complete\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
