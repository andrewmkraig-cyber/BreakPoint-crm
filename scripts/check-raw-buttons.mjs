// Build-time guard: no hand-rolled <button> outside src/components/ui/.
//
// Every interactive button in Ace must route through the shared <Button>
// component (src/components/ui/button.tsx) per the Button Standard. Raw
// lowercase <button> JSX is only allowed inside src/components/ui/ (where
// the shared component itself lives).
//
// Grandfathering: existing violations are recorded in
// scripts/raw-button-baseline.json (file -> allowed count). The build
// passes as long as no file EXCEEDS its baseline and no NEW file introduces
// a raw <button>. So today's build stays green, but any future hand-rolled
// button - a brand-new one, or an extra one added to a grandfathered file -
// fails the build. Reducing a file's count is always fine.
//
// Regenerate the baseline (e.g. after intentionally retiring a violation,
// or to re-grandfather) with:
//   node scripts/check-raw-buttons.mjs --update
//
// Wired into `npm run build` so Vercel and local builds both enforce it.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");
const BASELINE_PATH = join(ROOT, "scripts", "raw-button-baseline.json");

// Directory (repo-relative, posix) where raw <button> is allowed - the
// shared component and its siblings live here.
const ALLOWED_PREFIX = "src/components/ui/";

// Matches an opening lowercase <button tag: `<button` followed by
// whitespace, `>`, or `/`. Case-sensitive, so `<Button` (the shared
// component) never matches. Closing tags `</button>` never match because
// the literal `<button` substring isn't present in `</button`.
const RAW_BUTTON_RE = /<button(?=[\s/>])/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relPosix(full) {
  return relative(ROOT, full).split(sep).join("/");
}

// Current count of raw <button> per repo-relative file, outside the allowed dir.
const current = {};
for (const full of walk(SRC)) {
  const rel = relPosix(full);
  if (rel.startsWith(ALLOWED_PREFIX)) continue;
  const matches = readFileSync(full, "utf8").match(RAW_BUTTON_RE);
  if (matches) current[rel] = matches.length;
}

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(current).sort());
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(
    `Wrote baseline: ${Object.keys(sorted).length} grandfathered file(s), ${total} raw <button> tag(s).`,
  );
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(
    `Missing/invalid ${relPosix(BASELINE_PATH)}. Generate it with:\n  node scripts/check-raw-buttons.mjs --update`,
  );
  process.exit(1);
}

const violations = [];
for (const [rel, count] of Object.entries(current)) {
  const allowed = baseline[rel] ?? 0;
  if (count > allowed) violations.push({ file: rel, count, allowed });
}

if (violations.length > 0) {
  console.error("\n✖ Raw <button> check failed.\n");
  console.error(
    "Use the shared <Button> component from src/components/ui/button.tsx.",
  );
  console.error("Raw <button> is only allowed inside src/components/ui/.\n");
  for (const v of violations.sort((a, b) => a.file.localeCompare(b.file))) {
    const what = v.allowed === 0 ? "new raw <button>" : `${v.count} raw <button> (baseline allowed ${v.allowed})`;
    console.error(`  ${v.file}: ${what}`);
  }
  console.error(
    `\n${violations.length} file(s) over budget. Convert to <Button>, or if a raw`,
  );
  console.error(
    "<button> is genuinely unavoidable move it into src/components/ui/.",
  );
  console.error(
    "To deliberately re-grandfather: node scripts/check-raw-buttons.mjs --update\n",
  );
  process.exit(1);
}

const files = Object.keys(baseline).length;
const total = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(
  `✓ Raw <button> check passed (${files} grandfathered file(s) / ${total} tag(s), none exceeded).`,
);
process.exit(0);
