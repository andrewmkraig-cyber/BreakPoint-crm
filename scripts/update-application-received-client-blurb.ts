// DATA fix: in the "Application Received" template, swap the named-client
// token for the anonymous blurb token:
//   "This is with [Client Company Name]."  ->  "This is with {{client_blurb}}."
//
// {{client_blurb}} resolves in every send path this template can take:
//   - trigger / confirmation send  -> fireTemplatedEmail -> applyMergeFields,
//     fed by buildPlacementMergeValues which now resolves the blurb via the
//     shared resolveClientBlurb (saved blurb, else generate-once, else
//     "a confidential client") — never blank, never literal.
//   - bulk email                   -> applyMergeFields (same shared resolver).
//
// SAFETY
// - Targets exactly ONE row by id. EmailTemplate is a GLOBAL (single-org) table.
// - Dry-run by DEFAULT: prints before/after body and stops. --apply to write.
// - Idempotent: re-run after a successful apply is a clean no-op.
// - Post-condition guard: refuses to APPLY (and warns on dry-run) if ANY
//   [Client Company Name] token would remain — the client name must appear
//   nowhere in the template after the swap.
//
// Usage from repo root (env auto-loaded from .env.local):
//   npx tsx scripts/update-application-received-client-blurb.ts          # dry run
//   npx tsx scripts/update-application-received-client-blurb.ts --apply  # write

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

const TEMPLATE_ID = "cmo38qh4j0002kv04gnn6es8g";
const FIND = "This is with [Client Company Name].";
const REPLACE = "This is with {{client_blurb}}.";
const CLIENT_NAME_TOKEN = "[Client Company Name]";

function countToken(s: string, token: string): number {
  return s.split(token).length - 1;
}

async function main() {
  console.log(`Mode: ${apply ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);

  const tpl = await prisma.emailTemplate.findUnique({
    where: { id: TEMPLATE_ID },
    select: { id: true, name: true, isActive: true, subject: true, body: true, updatedAt: true },
  });
  if (!tpl) {
    console.log(`\nNo template with id ${TEMPLATE_ID}. Nothing to do.`);
    return;
  }

  console.log(`\n=== CURRENT === name="${tpl.name}" active=${tpl.isActive} updatedAt=${tpl.updatedAt.toISOString()}`);
  console.log("\n--- CURRENT BODY (exact) ---\n" + tpl.body);

  const present = tpl.body.includes(FIND);
  const alreadyDone = tpl.body.includes(REPLACE);
  const nextBody = present ? tpl.body.split(FIND).join(REPLACE) : tpl.body;

  if (!present) {
    console.log(
      alreadyDone
        ? `\nSwap already applied (body already has "${REPLACE}"). No-op.`
        : `\nTarget phrase not found ("${FIND}"). Template may have drifted — not touching.`,
    );
  } else {
    console.log(`\n=== PROPOSED NEW BODY (exact) ===\n` + nextBody);
  }

  // Post-condition: no client-name token may remain anywhere in subject/body.
  const remaining =
    countToken(tpl.subject, CLIENT_NAME_TOKEN) + countToken(nextBody, CLIENT_NAME_TOKEN);
  console.log(`\nRemaining "${CLIENT_NAME_TOKEN}" tokens after swap: ${remaining}`);
  if (remaining > 0) {
    console.log(
      `⚠️  Client name still present — review the other occurrence(s). Will NOT apply until clean.`,
    );
  }

  if (nextBody === tpl.body) {
    console.log("\nNo change to write.");
    return;
  }
  if (!apply) {
    console.log("\nDRY RUN complete. Re-run with --apply to write.");
    return;
  }
  if (remaining > 0) {
    console.log("\nABORT: client-name token still present. Not writing.");
    process.exitCode = 1;
    return;
  }

  await prisma.emailTemplate.update({
    where: { id: tpl.id },
    data: { body: nextBody },
  });
  const after = await prisma.emailTemplate.findUnique({
    where: { id: tpl.id },
    select: { body: true },
  });
  console.log("\n=== APPLIED. FINAL BODY (exact) ===\n" + after?.body);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
