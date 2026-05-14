// One-shot cleanup that undoes scripts/seed-bd-visual-data.ts. Removes
// seeded ClientSignal, BDActivity, Campaign, and CampaignEvent rows.
// Leaves Vertical / SavedSearch / SendingDomain (infrastructure rows
// from seed-bd-test-data.ts) and any real BDRun intact.
//
// Idempotent: re-running is a no-op once the seeded rows are gone.
//
// Usage:
//   set -a; source .env.local; set +a; npx tsx scripts/cleanup-bd-visual-data.ts

import { prisma } from "../src/lib/prisma";

const ORGANIZATION_ID = "cmobj8dxz00012gliequ53kvc";

const CLIENT_SIGNAL_URLS = [
  "https://www.indeed.com/viewjob?jk=placeholder1",
  "https://www.indeed.com/viewjob?jk=placeholder2",
  "https://www.indeed.com/viewjob?jk=placeholder3",
];

const BD_ACTIVITY_SEED_KEYS = [
  "scan-2h",
  "enrich-2h",
  "enroll-2h",
  "open-30m",
  "reply-15m",
  "enroll-yesterday-3pm",
  "domain-cooled-yesterday-10am",
  "bounce-2d",
];

const CAMPAIGN_EVENT_SEED_MARKER = "bd-visual-001";
const CAMPAIGN_SEED_MARKER = "placeholder-sequence-id";

async function main(): Promise<void> {
  console.log("\n=== BD visual data cleanup ===\n");

  const org = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`Organization ${ORGANIZATION_ID} not found`);
  console.log(`Org: ${org.name} (${org.id})\n`);

  // Events first — CampaignEvent has an FK on Campaign, so deleting
  // campaigns before events would error on the dangling rows.
  const eventRes = await prisma.campaignEvent.deleteMany({
    where: {
      organizationId: org.id,
      metadata: { path: ["seedKey"], equals: CAMPAIGN_EVENT_SEED_MARKER },
    },
  });
  console.log(`CampaignEvent: deleted ${eventRes.count}`);

  const campaignRes = await prisma.campaign.deleteMany({
    where: {
      organizationId: org.id,
      apolloSequenceId: CAMPAIGN_SEED_MARKER,
    },
  });
  console.log(`Campaign: deleted ${campaignRes.count}`);

  let bdActivityDeleted = 0;
  for (const key of BD_ACTIVITY_SEED_KEYS) {
    const res = await prisma.bDActivity.deleteMany({
      where: {
        organizationId: org.id,
        metadata: { path: ["seedKey"], equals: key },
      },
    });
    bdActivityDeleted += res.count;
  }
  console.log(`BDActivity: deleted ${bdActivityDeleted}`);

  const signalRes = await prisma.clientSignal.deleteMany({
    where: {
      organizationId: org.id,
      externalUrl: { in: CLIENT_SIGNAL_URLS },
    },
  });
  console.log(`ClientSignal: deleted ${signalRes.count}`);

  console.log("\n✅ Cleanup complete\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
