#!/usr/bin/env node
// Build gate: the Instantly integration is READ ONLY, enforced.
//
// Ace must never send, reply, forward, create, pause, or modify anything
// in Instantly. That was a convention held up by code review; this makes
// it a build failure.
//
// The check fails if anything under src/lib/instantly/ either:
//   - sets an HTTP method other than GET, or
//   - references a known Instantly write endpoint path.
//
// Wired into `npm run check:ui`, so local builds and Vercel both enforce
// it. If you are here because this failed: that is the gate working. Do
// not weaken it to ship a write - the read-only guarantee is the whole
// basis on which this integration was approved.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib/instantly";

// `method:` set to anything that isn't GET.
const NON_GET_METHOD = /method\s*:\s*["'`](?!GET["'`])(POST|PUT|PATCH|DELETE)["'`]/gi;

// Instantly's documented write endpoints. Matched as string literals so
// a comment mentioning them (as several files legitimately do, to record
// that they are deliberately omitted) does not trip the gate.
const WRITE_ENDPOINTS = [
  /["'`][^"'`]*\/emails\/[^"'`]*\/reply["'`]/gi,
  /["'`][^"'`]*\/emails\/[^"'`]*\/forward["'`]/gi,
  /["'`]\/emails\/test["'`]/gi,
  /["'`][^"'`]*\/campaigns\/[^"'`]*\/(activate|pause|launch)["'`]/gi,
  /["'`]\/leads\/[^"'`]*\/(create|update|delete)["'`]/gi,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Strip comments so prose about omitted write endpoints doesn't fail the
// build. Only executable code is inspected.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

let files;
try {
  files = walk(ROOT);
} catch {
  console.log(`✓ Instantly read-only check skipped (${ROOT} not present).`);
  process.exit(0);
}

const violations = [];

for (const file of files) {
  const code = stripComments(readFileSync(file, "utf8"));

  for (const m of code.matchAll(NON_GET_METHOD)) {
    violations.push({ file, detail: `HTTP method "${m[1].toUpperCase()}"` });
  }
  for (const pattern of WRITE_ENDPOINTS) {
    for (const m of code.matchAll(pattern)) {
      violations.push({ file, detail: `write endpoint ${m[0]}` });
    }
  }
}

if (violations.length > 0) {
  console.error("\n✖ Instantly read-only check FAILED.\n");
  console.error("The Instantly integration must never write. Found:\n");
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.detail}`);
  }
  console.error(
    "\nAce may only read from Instantly (GET). Sending, replying,\n" +
      "forwarding, pausing, and editing all happen in Instantly itself.\n" +
      "Do not weaken this gate to land a write.\n",
  );
  process.exit(1);
}

console.log(
  `✓ Instantly read-only check passed (${files.length} file(s), GET only, no write endpoints).`,
);
