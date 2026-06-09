// One-time DATA fix: enrich the seeded "Invoice Email" template so the drafted
// invoice email carries the invoice-specific details the old hardcoded body had
// (invoice number in the subject, fee amount + due date in the body).
//
// BACKGROUND
// Ace 89.0 wired the Settings "Invoice Email" template into the invoice draft
// send path (handleEmailDraft resolves it via applyMergeFields). The stored
// template body, however, was the simpler seed copy - it did NOT reference the
// invoice number, the fee amount, or the due date, so wiring it in dropped
// those details from the email. The [Invoice Number] / [Fee Amount] /
// [Invoice Due Date] merge tokens were registered the same session, so this
// one-time edit works them into the stored template.
//
// WHAT IT CHANGES (the single active "Invoice Email" template row)
//   Subject: appends " ([Invoice Number])".
//     NOTE: [Invoice Number] resolves to "INV-####" (the invoiceNumber field
//     already carries the INV- prefix), so the suffix is "([Invoice Number])"
//     - writing "(INV-[Invoice Number])" would double the prefix to
//     "(INV-INV-1054)". The rendered result is e.g. "... placement (INV-1054)".
//   Body: turns "...for the placement fee, with a start date of [Start Date]."
//     into "...for the placement fee of [Fee Amount], with a start date of
//     [Start Date]. Payment is due by [Invoice Due Date]." Existing voice +
//     structure preserved; no full rewrite; no em dashes.
//
// SAFETY
// - EmailTemplate is a GLOBAL (single-org) table - it has no organizationId
//   column, so the row is selected by trigger ("confirmed_start_invoice") +
//   isActive, the canonical loadTriggeredTemplate selector. The BreakPoint org
//   id is recorded here for traceability only.
// - Both transforms are idempotent (guarded so a re-run is a no-op) and the
//   body transform ABORTS if its target sentence isn't found, so a drifted
//   body is never blindly mangled.
// - Dry-run by default: prints the current row + the before/after and stops.
//   Pass --apply to write. Updates exactly ONE row, by id. Touches no other
//   template and no product code.
//
// Usage from repo root (env auto-loaded from .env.local):
//   npx tsx scripts/update-invoice-email-template.ts            # dry run
//   npx tsx scripts/update-invoice-email-template.ts --apply    # write to prod

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { applyMergeFields } from "@/lib/merge-fields";

const prisma = new PrismaClient();

// BreakPoint Talent prod org (ACE_RULES.md ▸ Tenant Scoping). Recorded for
// traceability; EmailTemplate has no organizationId so it is not a query
// filter here.
const BREAKPOINT_ORG = "cmobj8dxz00012gliequ53kvc";
const TRIGGER = "confirmed_start_invoice";
const TEMPLATE_NAME = "Invoice Email";

const apply = process.argv.includes("--apply");

function transformSubject(subject: string): string {
  // Idempotent: leave alone if the token is already present.
  if (subject.includes("[Invoice Number]")) return subject;
  return `${subject} ([Invoice Number])`;
}

// Returns the new body, or null when the expected fee sentence isn't found
// (so we never blind-write a drifted body).
function transformBody(body: string): string | null {
  // Idempotent: if either invoice-specific token is already in, no change.
  if (body.includes("[Fee Amount]") || body.includes("[Invoice Due Date]")) return body;
  const target = "for the placement fee, with a start date of [Start Date].";
  const replacement =
    "for the placement fee of [Fee Amount], with a start date of [Start Date]. Payment is due by [Invoice Due Date].";
  if (!body.includes(target)) return null;
  return body.replace(target, replacement);
}

async function main() {
  console.log(`Org (traceability only): ${BREAKPOINT_ORG}`);
  console.log(`Mode: ${apply ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);

  const rows = await prisma.emailTemplate.findMany({
    where: { trigger: TRIGGER, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, subject: true, body: true, isActive: true, updatedAt: true },
  });
  const matches = rows.filter((r) => r.name === TEMPLATE_NAME);

  if (matches.length === 0) {
    console.log(`\nNo active "${TEMPLATE_NAME}" template (trigger=${TRIGGER}) found. Nothing to do.`);
    return;
  }
  if (matches.length > 1) {
    console.log(
      `\nWARNING: ${matches.length} active "${TEMPLATE_NAME}" rows found. Updating the most ` +
        `recently updated (loadTriggeredTemplate semantics); ids: ${matches.map((m) => m.id).join(", ")}`,
    );
  }
  const tpl = matches[0];

  console.log(`\n=== CURRENT ROW === id=${tpl.id}  updatedAt=${tpl.updatedAt.toISOString()}`);
  console.log("\n--- CURRENT SUBJECT (exact) ---\n" + tpl.subject);
  console.log("\n--- CURRENT BODY (exact) ---\n" + tpl.body);

  const newSubject = transformSubject(tpl.subject);
  const newBody = transformBody(tpl.body);

  if (newBody === null) {
    console.log(
      `\nABORT: the expected fee sentence ("for the placement fee, with a start date of ` +
        `[Start Date].") was not found in the stored body. The body may have been edited. ` +
        `No change written. Review the body above and adjust the script's target string.`,
    );
    return;
  }

  const subjectChanged = newSubject !== tpl.subject;
  const bodyChanged = newBody !== tpl.body;

  console.log("\n=== PROPOSED NEW SUBJECT (exact) ===\n" + newSubject);
  console.log("\n=== PROPOSED NEW BODY (exact) ===\n" + newBody);

  // Illustrative render with sample values so the rendered wording is visible
  // (proves no double "INV-" prefix). Not written anywhere.
  const sampleValues = {
    greeting: "Hi Laurie and Benjy,",
    clientCompanyName: "BreakPoint Talent",
    candidateFullName: "Ethan Larocca",
    jobTitle: "Senior Developer",
    startDate: "Jun 1, 2026",
    invoiceNumber: "INV-1054",
    feeAmount: "$3,750.00",
    invoiceDueDate: "Jun 11, 2026",
  };
  console.log("\n--- ILLUSTRATIVE RENDER (sample values, not stored) ---");
  console.log("Subject: " + applyMergeFields(newSubject, sampleValues).replace(/—/g, "-"));
  console.log("Body:\n" + applyMergeFields(newBody, sampleValues).replace(/—/g, "-"));

  if (!subjectChanged && !bodyChanged) {
    console.log("\nNo changes needed (already enriched). No-op.");
    return;
  }

  if (!apply) {
    console.log("\nDRY RUN complete. Re-run with --apply to write the above to the DB.");
    return;
  }

  await prisma.emailTemplate.update({
    where: { id: tpl.id },
    data: { subject: newSubject, body: newBody },
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
