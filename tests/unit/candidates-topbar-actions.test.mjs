// Smoke test: the Candidates page topbar must declare only its core
// action: "New Candidate".
//
// THE BUG THIS GUARDS: Add Multiple was removed because the flow was not
// reliable. The Candidates topbar should not grow that import button back;
// recruiters should use the single New Candidate flow from this screen.
//
// Why source-level, not a DOM render: the topbar lives in
// src/components/top-bar-page-title.tsx, a "use client" component wired to
// Next navigation hooks, and its pathname->Spec resolver is not exported -
// so it can't be imported into a plain node test, and the repo has no React
// render-test framework. The declarative Spec map IS what renders the
// topbar actions, so asserting the "/candidates" spec carries only the
// supported action is a faithful tripwire. If the action moves to a different
// mechanism, update this test to point at the new source of truth.
//
// Framework-free per the tests/unit convention. Run via:
//   node tests/unit/candidates-topbar-actions.test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const FILE = join(ROOT, "src", "components", "top-bar-page-title.tsx");

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed = true;
  }
}

const src = readFileSync(FILE, "utf8");

// Isolate the `pathname === "/candidates"` spec branch so a "New Candidate"
// string elsewhere (e.g. the /candidates/new title branch) can't mask a
// dropped action inside the list-page spec.
const marker = 'pathname === "/candidates"';
const start = src.indexOf(marker);
assert(start !== -1, `top-bar-page-title.tsx has a \`${marker}\` spec branch`);

let block = "";
if (start !== -1) {
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  assert(end !== -1, "the /candidates spec branch has a balanced { ... } body");
  block = end !== -1 ? src.slice(braceStart, end + 1) : "";
}

assert(
  /label:\s*"New Candidate"/.test(block),
  'Candidates topbar declares the primary "New Candidate" action',
);
assert(
  !/kind:\s*"candidate-add-multiple"/.test(block) &&
    !/label:\s*"Add Multiple"/.test(block),
  'Candidates topbar does not declare the removed "Add Multiple" action',
);

if (failed) {
  console.error("\n✖ Candidates topbar smoke test failed.");
  console.error(
    "The Candidates topbar action set no longer matches the supported flow.",
  );
  process.exit(1);
}

console.log(
  "✓ Candidates topbar smoke test passed (only New Candidate present).",
);
process.exit(0);
