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

// Tenant-owned tables — every existing row gets the default orgId stamped.
// Each entry is (label, count+update pair). We keep these as separate calls
// rather than a generic loop so TypeScript can check the delegate names.
async function stamp(orgId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  out["Candidate"] = (
    await prisma.candidate.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["Job"] = (
    await prisma.job.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["Client"] = (
    await prisma.client.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["Contact"] = (
    await prisma.contact.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["Placement"] = (
    await prisma.placement.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["Interview"] = (
    await prisma.interview.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["ClientAgreement"] = (
    await prisma.clientAgreement.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["ClientBenefits"] = (
    await prisma.clientBenefits.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["ClientBenefitsFile"] = (
    await prisma.clientBenefitsFile.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["CandidateResume"] = (
    await prisma.candidateResume.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["JobOverride"] = (
    await prisma.jobOverride.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;
  out["KrispcallLog"] = (
    await prisma.krispcallLog.updateMany({ where: { organizationId: null }, data: { organizationId: orgId } })
  ).count;

  return out;
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
