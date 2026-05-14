// One-shot seed for BD Phase 2 visual verification. Inserts realistic
// rows so the four BD pages (Client Signal, Active Campaigns,
// Activity, Today's Launch) render with content instead of empty
// states.
//
// What it creates:
//   - 3 ClientSignal rows tied to existing Client records
//   - 8 BDActivity rows spread across Today / Yesterday / 2 days ago
//   - 1 Campaign tied to the existing QUEUED BDRun
//   - 72 CampaignEvents — 64 ENROLL (one per enrolled contact, the
//     Apollo per-webhook-event model) + 4 OPEN + 2 REPLY + 1 BOUNCE +
//     1 UNSUB. The 64 ENROLLs are what the current /bd/campaigns page
//     uses as the percentage denominator (per the Phase 2 page logic
//     that aggregates from CampaignEvent rather than from
//     Campaign.enrolled), so this is what makes Opened/Replied/Bounced
//     render as 6.25% / 3.1% / 1.6%.
//
// Idempotent: every block checks for existing rows by natural key /
// seedKey before inserting. Re-running is safe.
//
// Usage:
//   set -a; source .env.local; set +a; npx tsx scripts/seed-bd-visual-data.ts

import { prisma } from "../src/lib/prisma";

const ORGANIZATION_ID = "cmobj8dxz00012gliequ53kvc";

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Schema notes:
//   - ClientSignal field is `externalUrl` (the brief calls it indeedUrl)
//   - ClientSignal field is `actedAt` (the brief calls it reachedOutAt)
//   - BDActivity field is `metadata` (the brief calls it payload)
//   - CampaignEvent.apolloContactId is a free-form String? — not a FK
//     to Contact. Ace doesn't ingest Apollo contacts. Synthesized
//     placeholder ids are fine.
//   - Campaign has `active: Boolean` (the brief mentions a status enum
//     like ACTIVE / RUNNING — no such enum exists in Phase 1 schema).

const CLIENT_SIGNALS = [
  {
    clientNameQuery: "Sheehan Brothers Vending",
    jobTitle: "Operations Manager",
    location: "Springfield, OH",
    detectedAt: new Date(NOW - 2 * DAY),
    externalUrl: "https://www.indeed.com/viewjob?jk=placeholder1",
    status: "NEW" as const,
    actedAt: null as Date | null,
  },
  {
    clientNameQuery: "tsaADVET",
    jobTitle: "Senior Software Engineer",
    location: "Pittsburgh, PA",
    detectedAt: new Date(NOW - 5 * DAY),
    externalUrl: "https://www.indeed.com/viewjob?jk=placeholder2",
    status: "NEW" as const,
    actedAt: null as Date | null,
  },
  {
    clientNameQuery: "Excellware",
    jobTitle: "Senior Database Administrator",
    location: "North Royalton, OH",
    detectedAt: new Date(NOW - 9 * DAY),
    externalUrl: "https://www.indeed.com/viewjob?jk=placeholder3",
    status: "ACTED" as const,
    actedAt: new Date(NOW - 7 * DAY),
  },
];

// BDActivity rows the brief listed. The seedKey ties each row to the
// brief slot so a re-run is a no-op (we look up by metadata.seedKey
// before inserting).
const BD_ACTIVITIES: ReadonlyArray<{
  seedKey: string;
  kind: BDKind;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}> = [
  {
    seedKey: "scan-2h",
    kind: "SCAN_COMPLETE",
    occurredAt: new Date(NOW - 2 * HOUR),
    metadata: { vertical: "Public Accounting", companies: 18, companiesFound: 18 },
  },
  {
    seedKey: "enrich-2h",
    kind: "ENRICH",
    occurredAt: new Date(NOW - 2 * HOUR + 5 * MIN),
    metadata: { contacts: 64, contactsEnriched: 64, totalAttempted: 72 },
  },
  {
    seedKey: "enroll-2h",
    kind: "ENROLL",
    occurredAt: new Date(NOW - 2 * HOUR + 10 * MIN),
    metadata: {
      sequenceName: "BD Outbound v1",
      contacts: 64,
      contactsEnrolled: 64,
    },
  },
  {
    seedKey: "open-30m",
    kind: "OPEN",
    occurredAt: new Date(NOW - 30 * MIN),
    metadata: { contactName: "Sarah Linden", company: "Henderson CPA", subject: "Quick intro" },
  },
  {
    seedKey: "reply-15m",
    kind: "REPLY",
    occurredAt: new Date(NOW - 15 * MIN),
    metadata: { contactName: "Mike Davis", company: "Riverside Tax", subject: "Re: Quick intro" },
  },
  {
    seedKey: "enroll-yesterday-3pm",
    kind: "ENROLL",
    occurredAt: new Date(NOW - 25 * HOUR),
    metadata: { stepNumber: 1, domain: "outreach1.breakpointconnect.com", sentCount: 16 },
  },
  {
    seedKey: "domain-cooled-yesterday-10am",
    kind: "DOMAIN_COOLED",
    occurredAt: new Date(NOW - 30 * HOUR),
    metadata: { domain: "outreach3.breakpointconnect.com", reason: "open_rate_below_threshold" },
  },
  {
    seedKey: "bounce-2d",
    kind: "BOUNCE",
    occurredAt: new Date(NOW - 50 * HOUR),
    metadata: { contactName: "Invalid Contact", email: "invalid@defunct-llc.example", company: "Defunct LLC", bounceType: "hard" },
  },
];

type BDKind =
  | "SCAN_COMPLETE"
  | "ENRICH"
  | "ENROLL"
  | "OPEN"
  | "REPLY"
  | "BOUNCE"
  | "UNSUB"
  | "DOMAIN_COOLED"
  | "DOMAIN_RESUMED";

const CAMPAIGN_EVENT_TOTALS = {
  ENROLL: 64,
  OPEN: 4,
  REPLY: 2,
  BOUNCE: 1,
  UNSUB: 1,
} as const;

async function main(): Promise<void> {
  console.log("\n=== BD visual data seed ===\n");

  const org = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`Organization ${ORGANIZATION_ID} not found`);
  console.log(`Org: ${org.name} (${org.id})\n`);

  await seedClientSignals(org.id);
  console.log("");

  const run = await prisma.bDRun.findFirst({
    where: { organizationId: org.id, status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, verticalId: true, savedSearchId: true, savedSearch: { select: { name: true } } },
  });
  if (!run) {
    console.warn("⚠ No QUEUED BDRun found — skipping BDActivity, Campaign, and CampaignEvent seeding.");
    console.warn("  Run /bd/launch and click Launch BD Run first.");
    return;
  }
  if (!run.verticalId || !run.savedSearchId || !run.savedSearch) {
    console.warn(
      "⚠ Found a QUEUED BDRun but it has no vertical/savedSearch (likely a discovery run). Skipping campaign seed.",
    );
    return;
  }
  console.log(`Using BDRun ${run.id} (search: "${run.savedSearch.name}")\n`);

  await seedBdActivities(org.id, run.id);
  console.log("");

  const campaign = await seedCampaign(org.id, {
    id: run.id,
    verticalId: run.verticalId,
    savedSearchId: run.savedSearchId,
    savedSearch: run.savedSearch,
  });
  console.log("");

  if (campaign) {
    await seedCampaignEvents(org.id, campaign.id);
  }

  console.log("\n✅ Visual seed complete\n");
}

async function seedClientSignals(orgId: string): Promise<void> {
  for (const spec of CLIENT_SIGNALS) {
    const client = await prisma.client.findFirst({
      where: {
        organizationId: orgId,
        name: { contains: spec.clientNameQuery, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (!client) {
      console.warn(`⚠ ClientSignal: no client matching "${spec.clientNameQuery}" — skipping`);
      continue;
    }
    const result = await prisma.clientSignal.upsert({
      where: { organizationId_externalUrl: { organizationId: orgId, externalUrl: spec.externalUrl } },
      create: {
        organizationId: orgId,
        clientId: client.id,
        externalUrl: spec.externalUrl,
        jobTitle: spec.jobTitle,
        location: spec.location,
        status: spec.status,
        detectedAt: spec.detectedAt,
        actedAt: spec.actedAt,
      },
      update: {
        clientId: client.id,
        jobTitle: spec.jobTitle,
        location: spec.location,
        status: spec.status,
        detectedAt: spec.detectedAt,
        actedAt: spec.actedAt,
      },
      select: { id: true, status: true },
    });
    console.log(`ClientSignal: ${client.name} · ${spec.jobTitle} (${result.status})`);
  }
}

async function seedBdActivities(orgId: string, bdRunId: string): Promise<void> {
  for (const a of BD_ACTIVITIES) {
    const existing = await prisma.bDActivity.findFirst({
      where: {
        organizationId: orgId,
        metadata: { path: ["seedKey"], equals: a.seedKey },
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`BDActivity: ${a.kind} (${a.seedKey}) — already seeded, skipping`);
      continue;
    }
    await prisma.bDActivity.create({
      data: {
        organizationId: orgId,
        bdRunId,
        kind: a.kind,
        occurredAt: a.occurredAt,
        metadata: { ...a.metadata, seedKey: a.seedKey },
      },
    });
    console.log(`BDActivity: ${a.kind} (${a.seedKey})`);
  }
}

async function seedCampaign(
  orgId: string,
  run: { id: string; verticalId: string; savedSearchId: string; savedSearch: { name: string } },
): Promise<{ id: string } | null> {
  const existing = await prisma.campaign.findFirst({
    where: { organizationId: orgId, bdRunId: run.id },
    select: { id: true, name: true },
  });
  const counters = {
    enrolled: CAMPAIGN_EVENT_TOTALS.ENROLL,
    opens: CAMPAIGN_EVENT_TOTALS.OPEN,
    replies: CAMPAIGN_EVENT_TOTALS.REPLY,
    bounces: CAMPAIGN_EVENT_TOTALS.BOUNCE,
    unsubs: CAMPAIGN_EVENT_TOTALS.UNSUB,
  };
  if (existing) {
    const updated = await prisma.campaign.update({
      where: { id: existing.id },
      data: { ...counters, active: true },
      select: { id: true, name: true },
    });
    console.log(`Campaign: ${updated.name} (${updated.id}) — counters refreshed`);
    return { id: updated.id };
  }
  const created = await prisma.campaign.create({
    data: {
      organizationId: orgId,
      verticalId: run.verticalId,
      savedSearchId: run.savedSearchId,
      bdRunId: run.id,
      apolloSequenceId: "placeholder-sequence-id",
      name: run.savedSearch.name,
      active: true,
      startedAt: new Date(NOW - 2 * DAY),
      ...counters,
    },
    select: { id: true, name: true },
  });
  console.log(`Campaign: ${created.name} (${created.id})`);
  return { id: created.id };
}

async function seedCampaignEvents(orgId: string, campaignId: string): Promise<void> {
  // Idempotency marker: every seeded event carries seedKey =
  // "bd-visual-001". One probe per kind is enough — we only insert if
  // the expected count is missing for that kind.
  const SEED_MARKER = "bd-visual-001";

  for (const kind of Object.keys(CAMPAIGN_EVENT_TOTALS) as Array<keyof typeof CAMPAIGN_EVENT_TOTALS>) {
    const expected = CAMPAIGN_EVENT_TOTALS[kind];
    const existingCount = await prisma.campaignEvent.count({
      where: {
        organizationId: orgId,
        campaignId,
        kind,
        metadata: { path: ["seedKey"], equals: SEED_MARKER },
      },
    });
    if (existingCount >= expected) {
      console.log(`CampaignEvent: ${kind} × ${existingCount} — already seeded, skipping`);
      continue;
    }
    const toInsert = expected - existingCount;
    const rows = Array.from({ length: toInsert }, (_, i) => {
      const idx = existingCount + i;
      // Stagger events across the last 48h. ENROLL leans earlier in
      // the window (most contacts enrolled day 1), OPENs / REPLYs lean
      // recent. Mixed cadence so the timeline reads as realistic.
      const slot = kind === "ENROLL" ? 0.1 + (idx / expected) * 0.5 : 0.5 + (idx / expected) * 0.5;
      const offsetMs = Math.floor(slot * 48 * HOUR);
      return {
        organizationId: orgId,
        campaignId,
        kind,
        apolloContactId: `apollo_contact_${kind.toLowerCase()}_${idx + 1}`,
        occurredAt: new Date(NOW - offsetMs),
        metadata: { seedKey: SEED_MARKER, kindIndex: idx },
      };
    });
    await prisma.campaignEvent.createMany({ data: rows });
    console.log(`CampaignEvent: ${kind} × ${toInsert} inserted (total ${existingCount + toInsert})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
