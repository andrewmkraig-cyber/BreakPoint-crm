// One-shot replacement script: wipe placeholder sending domains and
// install the real five breakpoint-talent.com mailboxes Apollo rotates
// across at enrollment time.
//
// SendingDomain.domain is a free-form string in the schema, so we use
// it to hold the full mailbox address — one row per rotation slot,
// matching how the rest of the BD UI treats each row (= one slot in
// the pool, rendered with reputation 85 and owner "Andrew" by default).
//
// Idempotent: deletes every existing SendingDomain row for the org
// first, then upserts the five real rows. Safe to re-run; will not
// duplicate or leave stale placeholders behind.
//
// Usage:
//   set -a; source .env.local; set +a; npx tsx scripts/seed-bd-real-mailboxes.ts

import { prisma } from "../src/lib/prisma";

const ORGANIZATION_ID = "cmobj8dxz00012gliequ53kvc";

const REAL_MAILBOXES = [
  "andrew@breakpoint-talent.com",
  "a.kraig@breakpoint-talent.com",
  "andrew.kraig@breakpoint-talent.com",
  "andrewk@breakpoint-talent.com",
  "kraig@breakpoint-talent.com",
];

async function main(): Promise<void> {
  console.log("\n=== BD real mailbox seed ===\n");

  const org = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`Organization ${ORGANIZATION_ID} not found`);
  console.log(`Org: ${org.name} (${org.id})`);

  // Wipe all existing SendingDomain rows for the org so any leftover
  // placeholder breakpointconnect.com rows are gone. The unique
  // (organizationId, domain) constraint plus the upsert below would
  // tolerate stale rows, but the task brief is explicit about
  // replacing all rows, not coexisting.
  const deleted = await prisma.sendingDomain.deleteMany({
    where: { organizationId: org.id },
  });
  console.log(`Deleted ${deleted.count} existing SendingDomain rows`);

  // Insert the real mailboxes with a staggered lastUsedAt so the
  // rotation pool's `orderBy: lastUsedAt asc` puts row 1 first.
  const now = Date.now();
  for (let i = 0; i < REAL_MAILBOXES.length; i++) {
    const mailbox = REAL_MAILBOXES[i];
    const lastUsedAt = new Date(now - (REAL_MAILBOXES.length - i) * 60 * 60 * 1000);
    const result = await prisma.sendingDomain.upsert({
      where: {
        organizationId_domain: { organizationId: org.id, domain: mailbox },
      },
      create: {
        organizationId: org.id,
        domain: mailbox,
        status: "HEALTHY",
        inboxOwner: "Andrew",
        dailyCap: 20,
        lastUsedAt,
      },
      update: {
        status: "HEALTHY",
        inboxOwner: "Andrew",
        dailyCap: 20,
        lastUsedAt,
      },
      select: { id: true, domain: true, status: true, inboxOwner: true },
    });
    console.log(`SendingDomain: ${result.domain} (${result.status}, owner=${result.inboxOwner})`);
  }

  console.log("\n✅ Real mailbox seed complete\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
