// DATA sweep: modernize EVERY active email template from the full-location
// token [Job Location] to the city-only token {{job_city}}.
//
// WHY
// [Job Location] renders the full "City, ST 00000" string. Product direction
// is city-only outreach ("...in Great Neck" not "...in Great Neck, NY 11021").
// {{job_city}} resolves via the shared extractCityFromLocation in EVERY send
// path (bulk email, single Mail composer, and all trigger/confirmation sends
// through fireTemplatedEmail), so this swap is safe once that resolver code is
// deployed. This generalizes the one-off update-candidate-recruit-tokens.ts to
// the whole active template set.
//
// SAFETY
// - EmailTemplate is a GLOBAL (single-org) table — no organizationId column —
//   so "active org templates" == every row with isActive = true.
// - Dry-run by DEFAULT: prints a per-template before/after diff and stops.
//   Pass --apply to write. Pass --include-flagged to also write the templates
//   the heuristic flags as maybe-needing full location (off by default).
// - Idempotent: a template with no [Job Location] is skipped; a re-run after a
//   successful apply is a clean no-op.
// - APPLY ONLY AFTER the {{job_city}} resolver change is deployed — otherwise a
//   sent email would render the new token as literal text.
//
// Usage from repo root (env auto-loaded from .env.local):
//   npx tsx scripts/sweep-job-location-to-city.ts                  # dry run
//   npx tsx scripts/sweep-job-location-to-city.ts --apply          # write (unflagged only)
//   npx tsx scripts/sweep-job-location-to-city.ts --apply --include-flagged

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const includeFlagged = process.argv.includes("--include-flagged");

const FIND = "[Job Location]";
const REPLACE = "{{job_city}}";

// Heuristic: does the copy genuinely want the FULL location (street/zip/state),
// not just the city? If so we FLAG for human review instead of swapping. Kept
// deliberately TIGHT — only wording that a city alone can't satisfy. Things
// like "commute to", "on-site", "in office" read fine with a city, so they are
// NOT signals. Matched case-insensitive against the whole subject+body.
const FULL_LOCATION_SIGNALS =
  /\b(street address|mailing address|full address|home address|relocat\w*|zip\s*code|postal code|located at)\b/i;

function swap(text: string): string {
  return text.split(FIND).join(REPLACE);
}

// Pull just the lines that contain the token (subject is one "line"), so the
// diff stays readable for long bodies. Returns [{before, after}] per line.
function changedLines(label: string, before: string, after: string) {
  if (before === after) return [];
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const out: string[] = [];
  for (let i = 0; i < beforeLines.length; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      out.push(`    [${label} L${i + 1}]`);
      out.push(`      -  ${beforeLines[i]}`);
      out.push(`      +  ${afterLines[i]}`);
    }
  }
  return out;
}

async function main() {
  console.log(`Mode: ${apply ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Swap: "${FIND}"  ->  "${REPLACE}"   (active templates only)`);
  if (apply) console.log(`Flagged templates: ${includeFlagged ? "INCLUDED" : "SKIPPED (use --include-flagged to write them)"}`);

  const templates = await prisma.emailTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
    select: { id: true, name: true, subject: true, body: true, updatedAt: true },
  });

  console.log(`\nScanned ${templates.length} active template(s).\n`);

  let affected = 0;
  let flaggedCount = 0;
  let unaffected = 0;
  const toWrite: { id: string; subject: string; body: string }[] = [];

  for (const t of templates) {
    const hasToken = t.subject.includes(FIND) || t.body.includes(FIND);
    if (!hasToken) {
      unaffected++;
      continue;
    }
    affected++;
    const nextSubject = swap(t.subject);
    const nextBody = swap(t.body);
    const flagged = FULL_LOCATION_SIGNALS.test(`${t.subject}\n${t.body}`);
    if (flagged) flaggedCount++;

    const occ =
      (t.subject.match(/\[Job Location\]/g)?.length ?? 0) +
      (t.body.match(/\[Job Location\]/g)?.length ?? 0);

    const skipWrite = flagged && !includeFlagged;

    console.log(`────────────────────────────────────────────────────────`);
    console.log(`TEMPLATE: ${t.name}   (id=${t.id})`);
    console.log(`  occurrences of [Job Location]: ${occ}`);
    if (flagged) {
      console.log(
        `  ⚠️  FLAGGED: copy uses full-location wording (street/zip/relocation).`,
      );
      console.log(
        `      Review whether city-only is right here; ${skipWrite ? "NOT written unless --include-flagged." : "WILL be written."}`,
      );
    }
    const subjLines = changedLines("subject", t.subject, nextSubject);
    const bodyLines = changedLines("body", t.body, nextBody);
    if (subjLines.length) console.log(subjLines.join("\n"));
    if (bodyLines.length) console.log(bodyLines.join("\n"));

    if (!skipWrite) toWrite.push({ id: t.id, subject: nextSubject, body: nextBody });
  }

  console.log(`\n════════════════════ SUMMARY ════════════════════`);
  console.log(`  active templates scanned : ${templates.length}`);
  console.log(`  affected (have token)    : ${affected}`);
  console.log(`  of which flagged         : ${flaggedCount}`);
  console.log(`  unaffected (no token)    : ${unaffected}`);
  console.log(`  queued to write this run : ${toWrite.length}`);

  if (affected === 0) {
    console.log(`\nNothing to do — no active template contains "${FIND}". (Idempotent no-op.)`);
    return;
  }

  if (!apply) {
    console.log(
      `\nDRY RUN complete. No writes. Re-run with --apply to write — ONLY AFTER the {{job_city}} resolver is deployed.`,
    );
    return;
  }

  for (const w of toWrite) {
    await prisma.emailTemplate.update({
      where: { id: w.id },
      data: { subject: w.subject, body: w.body },
    });
  }
  console.log(`\nAPPLIED ${toWrite.length} template(s).`);
  if (flaggedCount > 0 && !includeFlagged) {
    console.log(`Left ${flaggedCount} flagged template(s) untouched — re-run with --include-flagged once reviewed.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
