// Phase 1 seed: creates the default BreakPoint Talent Organization, adds
// Andrew as owner + member, and stamps the resulting orgId onto every
// existing row in every tenant-owned table whose organizationId is still
// null. Idempotent — re-running against the same DB produces zero writes.
//
// Usage:
//   DATABASE_URL=<url> npx tsx scripts/seed-default-org.ts
//
// After seeding, DEFAULT_ORG_ID=<cuid> is written into .env.local so the
// runtime fallback in src/lib/auth/getCurrentOrg.ts can resolve an org for
// unauthenticated / transitional code paths.

import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma";

const ORG_NAME = "BreakPoint Talent";
const ORG_SLUG = "breakpoint-talent";
const OWNER_EMAIL = "andrew@breakpointtalent.com";

// Phase 5: backfill is a historical no-op. organizationId is NOT NULL
// on every tenant table now — Prisma won't accept `where: { organizationId:
// null }` as a filter. Left here as a placeholder so the seed script's
// contract (stamp(orgId) → per-table count map) stays stable; every
// count is zero post-Phase-5.
async function stamp(_orgId: string): Promise<Record<string, number>> {
  void _orgId;
  return {
    Candidate: 0,
    Job: 0,
    Client: 0,
    Contact: 0,
    Placement: 0,
    Interview: 0,
    ClientAgreement: 0,
    ClientBenefits: 0,
    ClientBenefitsFile: 0,
    CandidateResume: 0,
    JobOverride: 0,
    ActionLog: 0,
  };
}

// Updates (or inserts) the DEFAULT_ORG_ID line in .env.local without
// disturbing the other keys. Only run on local dev machines; production
// envs should set DEFAULT_ORG_ID via the hosting provider.
function writeEnvLocal(orgId: string): void {
  const envPath = path.join(process.cwd(), ".env.local");
  const key = "DEFAULT_ORG_ID";
  let body = "";
  if (fs.existsSync(envPath)) {
    body = fs.readFileSync(envPath, "utf8");
  }
  const line = `${key}=${orgId}`;
  if (body.split(/\r?\n/).some((l) => l.startsWith(`${key}=`))) {
    body = body.replace(new RegExp(`^${key}=.*$`, "m"), line);
  } else {
    body = body.endsWith("\n") || body.length === 0 ? `${body}${line}\n` : `${body}\n${line}\n`;
  }
  fs.writeFileSync(envPath, body);
}

async function main(): Promise<void> {
  console.log("\n=== Default org seed ===\n");

  const owner = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true },
  });
  if (!owner) throw new Error(`Owner user ${OWNER_EMAIL} not found`);

  // Upsert-by-slug so re-running is a no-op.
  const existing = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  let org: { id: string; createdAt: Date };
  if (existing) {
    console.log(`Organization already exists: ${existing.id} (created ${existing.createdAt.toISOString()})`);
    org = { id: existing.id, createdAt: existing.createdAt };
  } else {
    const created = await prisma.organization.create({
      data: {
        name: ORG_NAME,
        slug: ORG_SLUG,
        plan: "personal",
        ownerId: owner.id,
      },
      select: { id: true, createdAt: true },
    });
    console.log(`Created organization ${created.id}`);
    org = created;
  }

  // Owner membership — also idempotent.
  const membership = await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    create: { organizationId: org.id, userId: owner.id, role: "owner" },
    update: {}, // no-op on re-run
    select: { id: true, role: true },
  });
  console.log(`Owner membership: ${membership.id} (role=${membership.role})`);

  console.log("\nStamping organizationId on tenant rows…");
  const stamped = await stamp(org.id);
  console.log("\n=== Stamped counts ===");
  for (const [table, count] of Object.entries(stamped)) {
    console.log(`  ${table.padEnd(22)} ${count}`);
  }

  console.log("\nWriting DEFAULT_ORG_ID to .env.local…");
  writeEnvLocal(org.id);

  console.log(`\n✅ Seed complete. DEFAULT_ORG_ID=${org.id}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
