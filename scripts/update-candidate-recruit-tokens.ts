// One-time DATA fix: modernize the saved "Candidate Recruit" outreach
// template to use the new anonymized / city-only / inline-description merge
// fields. Consolidates THREE token swaps into one coherent edit:
//
//   1. "My client, [Client Company Name],"  ->  "My client, {{client_blurb}},"
//      (anonymous client descriptor; supersedes the earlier
//      update-candidate-recruit-blurb.ts, which was never applied)
//   2. "[Job Location]"  ->  "{{job_city}}"   (subject + body; city only,
//      so "Great Neck" instead of "Great Neck, NY 11021")
//   3. "[Job Description]"  ->  "{{job_description}}"  (plain-text JD body)
//
// IMPORTANT ABOUT THE LITERALS
// The task described a hardcoded "Great Neck, NY 11021" in the subject/body.
// The live template does NOT contain that literal — it uses the
// [Job Location] token, which RENDERS to "Great Neck, NY 11021" for a
// given job (the same way [Client Company Name] rendered to "InventWealth").
// This script therefore targets the actual [Job Location] token. Each swap
// is guarded: if its target isn't present the swap is skipped (and the run
// reports it) rather than blindly rewriting a drifted template.
//
// SAFETY
// - EmailTemplate is a GLOBAL (single-org) table (no organizationId), so the
//   row is selected by exact name "Candidate Recruit". Org id recorded for
//   traceability only.
// - Idempotent: a re-run after the swaps is a clean no-op.
// - Dry-run by default: prints current + before/after and stops. --apply to
//   write. Updates exactly ONE row, by id.
// - APPLY ONLY AFTER the code that resolves {{job_city}} / {{job_description}}
//   / {{client_blurb}} is deployed — otherwise the deployed resolver would
//   leave the new tokens literal in sent emails.
//
// Usage from repo root (env auto-loaded from .env.local):
//   npx tsx scripts/update-candidate-recruit-tokens.ts            # dry run
//   npx tsx scripts/update-candidate-recruit-tokens.ts --apply    # write

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// BreakPoint Talent prod org (traceability only; EmailTemplate has no
// organizationId so it is not a query filter here).
const BREAKPOINT_ORG = "cmobj8dxz00012gliequ53kvc";
const TEMPLATE_NAME = "Candidate Recruit";

const apply = process.argv.includes("--apply");

type Swap = {
  label: string;
  find: string;
  replace: string;
  // already-applied marker (idempotency): if present, treat as done.
  done: string;
  scope: "subject" | "body" | "both";
};

const SWAPS: Swap[] = [
  {
    label: "client name -> {{client_blurb}}",
    find: "My client, [Client Company Name], is looking to add a",
    replace: "My client, {{client_blurb}}, is looking to add a",
    done: "My client, {{client_blurb}}, is looking to add a",
    scope: "body",
  },
  {
    label: "[Job Location] -> {{job_city}}",
    find: "[Job Location]",
    replace: "{{job_city}}",
    done: "{{job_city}}",
    scope: "both",
  },
  {
    label: "[Job Description] -> {{job_description}}",
    find: "[Job Description]",
    replace: "{{job_description}}",
    done: "{{job_description}}",
    scope: "body",
  },
];

function applySwaps(subject: string, body: string) {
  let nextSubject = subject;
  let nextBody = body;
  const notes: string[] = [];
  for (const s of SWAPS) {
    const touchSubject = s.scope === "subject" || s.scope === "both";
    const touchBody = s.scope === "body" || s.scope === "both";
    const present =
      (touchSubject && subject.includes(s.find)) || (touchBody && body.includes(s.find));
    const alreadyDone =
      (touchSubject && subject.includes(s.done)) || (touchBody && body.includes(s.done));
    if (!present) {
      notes.push(
        alreadyDone
          ? `  - SKIP "${s.label}": already applied.`
          : `  - SKIP "${s.label}": target not found (template may have drifted).`,
      );
      continue;
    }
    if (touchSubject) nextSubject = nextSubject.split(s.find).join(s.replace);
    if (touchBody) nextBody = nextBody.split(s.find).join(s.replace);
    notes.push(`  - APPLIED "${s.label}".`);
  }
  return { nextSubject, nextBody, notes };
}

async function main() {
  console.log(`Org (traceability only): ${BREAKPOINT_ORG}`);
  console.log(`Mode: ${apply ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);

  const matches = await prisma.emailTemplate.findMany({
    where: { name: TEMPLATE_NAME },
    orderBy: { updatedAt: "desc" },
    select: { id: true, subject: true, body: true, isActive: true, updatedAt: true },
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

  const { nextSubject, nextBody, notes } = applySwaps(tpl.subject, tpl.body);
  console.log("\n=== SWAP REPORT ===\n" + notes.join("\n"));

  console.log("\n=== PROPOSED NEW SUBJECT (exact) ===\n" + nextSubject);
  console.log("\n=== PROPOSED NEW BODY (exact) ===\n" + nextBody);

  // Confirm the named-client + full-location tokens are gone after swaps.
  const leftover = {
    "[Client Company Name]": (nextBody.match(/\[Client Company Name\]/g) ?? []).length,
    "[Job Location]":
      (nextSubject.match(/\[Job Location\]/g) ?? []).length +
      (nextBody.match(/\[Job Location\]/g) ?? []).length,
    "[Job Description]": (nextBody.match(/\[Job Description\]/g) ?? []).length,
  };
  console.log("\nLeftover legacy tokens after swap:", JSON.stringify(leftover));

  if (nextSubject === tpl.subject && nextBody === tpl.body) {
    console.log("\nNo changes needed (already modernized). No-op.");
    return;
  }

  if (!apply) {
    console.log(
      "\nDRY RUN complete. Re-run with --apply to write — ONLY AFTER the resolver code is deployed.",
    );
    return;
  }

  await prisma.emailTemplate.update({
    where: { id: tpl.id },
    data: { subject: nextSubject, body: nextBody },
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
