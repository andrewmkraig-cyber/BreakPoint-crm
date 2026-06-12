// One-time DATA fix: swap the named client in the "Candidate Recruit"
// outreach template for the anonymous {{client_blurb}} merge field, so the
// opening line reads "My client, a growing CPA firm in Northeast Ohio, is
// looking to add a [Job Title]..." instead of naming the client.
//
// BACKGROUND
// The stored "Candidate Recruit" template (a manual-only, trigger=null row,
// identified by name) opens with:
//   "My client, [Client Company Name], is looking to add a [Job Title] ..."
// where [Client Company Name] resolves to the actual client name (e.g.
// "InventWealth") at send time. The new {{client_blurb}} field (registered
// in src/lib/merge-fields.ts, resolved at email-queue time in
// getJobMergeValuesForBulk) anonymizes that opener. This edit rewrites only
// that one clause; every other token (candidate name, job title, location,
// job description) is left intact.
//
// WHAT IT CHANGES (the single "Candidate Recruit" template row, by name)
//   Body: "My client, [Client Company Name], is looking to add a"
//      -> "My client, {{client_blurb}}, is looking to add a"
//   Subject: untouched (it carries no client name).
//
// SAFETY
// - EmailTemplate is a GLOBAL (single-org) table — no organizationId
//   column — so the row is selected by exact name "Candidate Recruit".
//   The BreakPoint org id is recorded for traceability only.
// - Idempotent: a re-run after the swap is a clean no-op.
// - ABORTS if the expected "My client, [Client Company Name]," clause isn't
//   found, so a hand-edited / drifted body is never blindly mangled.
// - Dry-run by default: prints the current row + before/after and stops.
//   Pass --apply to write. Updates exactly ONE row, by id.
//
// Usage from repo root (env auto-loaded from .env.local):
//   npx tsx scripts/update-candidate-recruit-blurb.ts            # dry run
//   npx tsx scripts/update-candidate-recruit-blurb.ts --apply    # write

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// BreakPoint Talent prod org (traceability only; EmailTemplate has no
// organizationId so it is not a query filter here).
const BREAKPOINT_ORG = "cmobj8dxz00012gliequ53kvc";
const TEMPLATE_NAME = "Candidate Recruit";

const CLIENT_NAME_TOKEN = "[Client Company Name]";
const TARGET = "My client, [Client Company Name], is looking to add a";
const REPLACEMENT = "My client, {{client_blurb}}, is looking to add a";

const apply = process.argv.includes("--apply");

// Returns the new body, or null when the expected clause isn't found.
function transformBody(body: string): string | null {
  // Idempotent: already swapped.
  if (body.includes("My client, {{client_blurb}}, is looking to add a")) return body;
  if (!body.includes(TARGET)) return null;
  return body.replace(TARGET, REPLACEMENT);
}

async function main() {
  console.log(`Org (traceability only): ${BREAKPOINT_ORG}`);
  console.log(`Mode: ${apply ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);

  const matches = await prisma.emailTemplate.findMany({
    where: { name: TEMPLATE_NAME },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, subject: true, body: true, isActive: true, updatedAt: true },
  });

  if (matches.length === 0) {
    console.log(`\nNo "${TEMPLATE_NAME}" template found. Nothing to do.`);
    return;
  }
  if (matches.length > 1) {
    console.log(
      `\nWARNING: ${matches.length} "${TEMPLATE_NAME}" rows found. Updating the most ` +
        `recently updated; ids: ${matches.map((m) => m.id).join(", ")}`,
    );
  }
  const tpl = matches[0];

  console.log(`\n=== CURRENT ROW === id=${tpl.id}  active=${tpl.isActive}  updatedAt=${tpl.updatedAt.toISOString()}`);
  console.log("\n--- CURRENT SUBJECT (exact) ---\n" + tpl.subject);
  console.log("\n--- CURRENT BODY (exact) ---\n" + tpl.body);

  const newBody = transformBody(tpl.body);
  if (newBody === null) {
    console.log(
      `\nABORT: expected clause ("${TARGET}") not found in the stored body. ` +
        `The template may have been hand-edited. No change written — review the body above.`,
    );
    return;
  }

  const bodyChanged = newBody !== tpl.body;

  console.log("\n=== PROPOSED NEW BODY (exact) ===\n" + newBody);

  // Confirm the named-client token appears nowhere else in body or subject.
  const bodyTokenCount = (newBody.match(/\[Client Company Name\]/g) ?? []).length;
  const subjectTokenCount = (tpl.subject.match(/\[Client Company Name\]/g) ?? []).length;
  console.log(
    `\nClient-name token "${CLIENT_NAME_TOKEN}" remaining — body: ${bodyTokenCount}, subject: ${subjectTokenCount}`,
  );
  if (bodyTokenCount > 0 || subjectTokenCount > 0) {
    console.log(
      "NOTE: the client-name token still appears elsewhere. Review whether those occurrences " +
        "should also become {{client_blurb}} before applying.",
    );
  }

  if (!bodyChanged) {
    console.log("\nNo changes needed (already anonymized). No-op.");
    return;
  }

  if (!apply) {
    console.log("\nDRY RUN complete. Re-run with --apply to write the above to the DB.");
    return;
  }

  await prisma.emailTemplate.update({
    where: { id: tpl.id },
    data: { body: newBody },
  });

  const after = await prisma.emailTemplate.findUnique({
    where: { id: tpl.id },
    select: { subject: true, body: true },
  });
  console.log("\n=== APPLIED. FINAL STORED ROW ===");
  console.log("\n--- FINAL SUBJECT (exact) ---\n" + after?.subject);
  console.log("\n--- FINAL BODY (exact) ---\n" + after?.body);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
