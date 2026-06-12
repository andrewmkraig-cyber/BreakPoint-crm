// Build-time guard: no NEW reads of legacy RecruiterFlow raw-blob data.
//
// Ace rows carry both canonical Neon columns AND a legacy RF `raw` JSON blob
// (the RFClient / RFCandidate / RFJob / RFContact shapes). Reading a value out
// of the raw blob to drive UI or logic is a trap: Ace-native rows have
// `raw === null`, so the read silently returns null for them. That was the
// 2026-06-12 client-card fee bug - the /clients cards read the fee from
// `raw.custom_fields` instead of the canonical `Client.feePct` column, so
// every Ace-native client showed no fee. The canonical column is the one
// source of truth; the raw blob is for unbackfilled legacy imports only.
//
// This gate counts legacy-blob READS and grandfathers today's. It does NOT
// flag writes that mirror canonical data into an RF shape for back-compat, nor
// the sanctioned RF shape/normalize layer (allowlisted below).
//
// What counts as a read (per non-comment line):
//   1. `.custom_fields`              - an RF custom-fields access (the bug field).
//   2. `.raw`/`.jobs ... as RF<Type>` - a record's raw blob (or RF jobs[]) cast
//                                       to an RF shape, i.e. the entry point of
//                                       every other RF-blob read (open_jobs,
//                                       files, salary_range_*, ...).
// A constructed literal cast like `{ ... } as RFJob` (a back-compat mirror) has
// no `.raw`/`.jobs` on the line, so it is correctly NOT counted.
//
// Grandfathering: existing reads are recorded in scripts/rf-blob-baseline.json
// (file -> allowed count). The build passes as long as no file EXCEEDS its
// baseline and no NEW file introduces a read. Reducing a count is always fine.
//
// Regenerate the baseline (after intentionally retiring reads, or to
// re-grandfather) with:
//   node scripts/check-rf-blob-reads.mjs --update
//
// Wired into `npm run check:ui`, so Vercel and local builds both enforce it.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");
const BASELINE_PATH = join(ROOT, "scripts", "rf-blob-baseline.json");

// Sanctioned RF-handling boundary - the layer whose JOB is to translate the
// RF raw blob into canonical shapes. Reads here are legitimate and not gated.
// Add import/migration handlers here if they ever need to parse raw blobs.
// Repo-relative posix prefixes; a file is exempt if its path starts with one.
const ALLOWLIST = [
  "src/lib/rf-payload-shapes.ts", // RF shape definitions + normalizers (getCustomField, normalizeJob/Candidate, ...)
];

// An RF custom-fields access - RF-specific, never a legitimate non-RF read.
const CUSTOM_FIELDS_RE = /\.custom_fields\b/g;
// An `as RF<Type>` cast (RFClient, RFCandidate, RFJob, RFContact,
// RFCandidateJob, ...). All RF-prefixed types are RecruiterFlow payload shapes.
const RF_CAST_RE = /\bas RF[A-Za-z]+\b/g;
// The cast only counts as a READ when the same line accesses a `.raw` blob or
// `.jobs` array - excludes constructed-literal mirrors (`{ ... } as RFJob`).
const RAW_SOURCE_RE = /\.(raw|jobs)\b/;

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function countRfBlobReads(content) {
  let n = 0;
  for (const line of content.split("\n")) {
    if (isCommentLine(line)) continue;
    const cf = line.match(CUSTOM_FIELDS_RE);
    if (cf) n += cf.length;
    if (RAW_SOURCE_RE.test(line)) {
      const casts = line.match(RF_CAST_RE);
      if (casts) n += casts.length;
    }
  }
  return n;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relPosix(full) {
  return relative(ROOT, full).split(sep).join("/");
}

function isAllowlisted(rel) {
  return ALLOWLIST.some((p) => rel === p || rel.startsWith(p.endsWith("/") ? p : p + "/"));
}

// Current count of legacy RF-blob reads per repo-relative file.
const current = {};
for (const full of walk(SRC)) {
  const rel = relPosix(full);
  if (isAllowlisted(rel)) continue;
  const count = countRfBlobReads(readFileSync(full, "utf8"));
  if (count > 0) current[rel] = count;
}

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(current).sort());
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(
    `Wrote baseline: ${Object.keys(sorted).length} grandfathered file(s), ${total} legacy RF-blob read(s).`,
  );
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(
    `Missing/invalid ${relPosix(BASELINE_PATH)}. Generate it with:\n  node scripts/check-rf-blob-reads.mjs --update`,
  );
  process.exit(1);
}

const violations = [];
for (const [rel, count] of Object.entries(current)) {
  const allowed = baseline[rel] ?? 0;
  if (count > allowed) violations.push({ file: rel, count, allowed });
}

if (violations.length > 0) {
  console.error("\n✖ Legacy RF-blob read check failed.\n");
  console.error(
    "Read from the canonical Neon column, not the legacy RF `raw` blob.",
  );
  console.error(
    "Ace-native rows have raw === null, so a raw-blob read returns null for them.",
  );
  console.error(
    "Resolve canonical-first (e.g. `client.feePct ?? extractFeePctFromCustomFields(raw?.custom_fields)`).\n",
  );
  for (const v of violations.sort((a, b) => a.file.localeCompare(b.file))) {
    const what = v.allowed === 0 ? "new legacy RF-blob read" : `${v.count} reads (baseline allowed ${v.allowed})`;
    console.error(`  ${v.file}: ${what}`);
  }
  console.error(
    `\n${violations.length} file(s) over budget. Point the read at the canonical column.`,
  );
  console.error(
    "Genuine RF shape/normalize code belongs in the allowlisted boundary layer.",
  );
  console.error(
    "To deliberately re-grandfather: node scripts/check-rf-blob-reads.mjs --update\n",
  );
  process.exit(1);
}

const files = Object.keys(baseline).length;
const total = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(
  `✓ Legacy RF-blob read check passed (${files} grandfathered file(s) / ${total} read(s), none exceeded).`,
);
process.exit(0);
