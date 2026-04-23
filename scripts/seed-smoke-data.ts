// Seeds a dedicated Client + Job + Contact into the ci-smoke Neon
// branch so the Playwright smoke test has deterministic data to drive
// the Apply / Submit / Interview flows against. Removes the test's
// dependency on RecruiterFlow being reachable from GitHub Actions
// runners.
//
// Idempotent. The three rows are keyed by the sentinel legacyRfId
// values SMOKE_CLIENT_RF / SMOKE_JOB_RF / SMOKE_CONTACT_RF — well
// outside any production RF id range. Re-runs are no-ops; schema
// drift doesn't drop data because we upsert on the legacyRfId unique
// constraint, not (id) which would be cuid.
//
// Usage: DATABASE_URL=<ci-smoke-url> npx tsx scripts/seed-smoke-data.ts

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const ORG_SLUG = "breakpoint-talent";
const SMOKE_CLIENT_RF = 999_999;
const SMOKE_JOB_RF = 999_998;
const SMOKE_CONTACT_RF = 999_997;

const SMOKE_CLIENT_NAME = "Smoke Test Inc";
const SMOKE_JOB_TITLE = "Smoke Test Field Engineer";
const SMOKE_CONTACT_NAME = { first: "Smoke", last: "Contact" };
const SMOKE_CONTACT_EMAIL = "smoke.contact@smoketestinc.example";

async function main(): Promise<void> {
  console.log("\n=== Smoke data seed ===\n");

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(
      `Organization "${ORG_SLUG}" missing — run scripts/seed-default-org.ts against this DB first.`,
    );
  }

  // ----- Client -----
  const clientPayload = {
    legacyRfId: SMOKE_CLIENT_RF,
    name: SMOKE_CLIENT_NAME,
    domain: "smoketestinc.example",
    organizationId: org.id,
    // Minimal raw payload in RFClient shape so Neon-shim read paths that
    // spread `raw` still return sensible fields.
    raw: {
      id: SMOKE_CLIENT_RF,
      name: SMOKE_CLIENT_NAME,
      domain: "smoketestinc.example",
    } as Prisma.InputJsonValue,
  };
  const client = await prisma.client.upsert({
    where: { legacyRfId: SMOKE_CLIENT_RF },
    create: clientPayload,
    update: {
      name: clientPayload.name,
      domain: clientPayload.domain,
      organizationId: clientPayload.organizationId,
      raw: clientPayload.raw,
    },
    select: { id: true, legacyRfId: true, name: true },
  });
  console.log(`Client:  ${client.id} (legacyRfId=${client.legacyRfId}) — ${client.name}`);

  // ----- Job -----
  const jobPayload = {
    legacyRfId: SMOKE_JOB_RF,
    title: SMOKE_JOB_TITLE,
    clientId: client.id,
    isOpen: true,
    organizationId: org.id,
    raw: {
      id: SMOKE_JOB_RF,
      title: SMOKE_JOB_TITLE,
      name: SMOKE_JOB_TITLE,
      is_open: true,
      company: { id: SMOKE_CLIENT_RF, name: SMOKE_CLIENT_NAME },
      locations: ["Remote"],
      description: "Synthetic job seeded for the Playwright smoke test.",
    } as Prisma.InputJsonValue,
  };
  const job = await prisma.job.upsert({
    where: { legacyRfId: SMOKE_JOB_RF },
    create: jobPayload,
    update: {
      title: jobPayload.title,
      clientId: jobPayload.clientId,
      isOpen: jobPayload.isOpen,
      organizationId: jobPayload.organizationId,
      raw: jobPayload.raw,
    },
    select: { id: true, legacyRfId: true, title: true },
  });
  console.log(`Job:     ${job.id} (legacyRfId=${job.legacyRfId}) — ${job.title}`);

  // ----- Contact -----
  const contactPayload = {
    legacyRfId: SMOKE_CONTACT_RF,
    firstName: SMOKE_CONTACT_NAME.first,
    lastName: SMOKE_CONTACT_NAME.last,
    name: `${SMOKE_CONTACT_NAME.first} ${SMOKE_CONTACT_NAME.last}`,
    emails: [SMOKE_CONTACT_EMAIL],
    clientId: client.id,
    currentDesignation: "Hiring Manager",
    organizationId: org.id,
    raw: {
      id: SMOKE_CONTACT_RF,
      first_name: SMOKE_CONTACT_NAME.first,
      last_name: SMOKE_CONTACT_NAME.last,
      name: `${SMOKE_CONTACT_NAME.first} ${SMOKE_CONTACT_NAME.last}`,
      email: [SMOKE_CONTACT_EMAIL],
      client_company_id: SMOKE_CLIENT_RF,
      client_company_name: SMOKE_CLIENT_NAME,
      current_designation: "Hiring Manager",
    } as Prisma.InputJsonValue,
  };
  const contact = await prisma.contact.upsert({
    where: { legacyRfId: SMOKE_CONTACT_RF },
    create: contactPayload,
    update: {
      firstName: contactPayload.firstName,
      lastName: contactPayload.lastName,
      name: contactPayload.name,
      emails: contactPayload.emails,
      clientId: contactPayload.clientId,
      currentDesignation: contactPayload.currentDesignation,
      organizationId: contactPayload.organizationId,
      raw: contactPayload.raw,
    },
    select: { id: true, legacyRfId: true, name: true },
  });
  console.log(`Contact: ${contact.id} (legacyRfId=${contact.legacyRfId}) — ${contact.name}`);

  console.log("\n✅ Smoke data ready.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
