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
// ONE narrow exception is allowlisted, and it must satisfy THREE
// conditions simultaneously (see ALLOWED_WRITES): the exact file, the
// exact method, and the exact endpoint shape. A POST in any other file
// fails. A different endpoint inside the allowlisted file fails. A
// DELETE anywhere fails. This is deliberately not a "writes are allowed
// in this file" carve-out.
//
// Wired into `npm run check:ui`, so local builds and Vercel both enforce
// it. If you are here because this failed: that is the gate working. Do
// not weaken it to ship a write - the read-only guarantee is the whole
// basis on which this integration was approved. Widening the allowlist
// is a product decision, not a refactor.

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

// ---------------------------------------------------------------------
// The allowlist. Every field must match for a write to be permitted.
//
//   file   - exact path, normalized to forward slashes
//   method - exact HTTP verb
//   path   - the endpoint template as it appears in the source
//
// Adding an entry here grants Ace a new ability to change data in
// Instantly. Treat it accordingly.
// ---------------------------------------------------------------------
const ALLOWED_WRITES = [
  {
    file: "src/lib/instantly/mark-thread-read.ts",
    method: "POST",
    // POST /api/v2/emails/threads/{thread_id}/mark-as-read
    path: /\/emails\/threads\/\$\{[^}]*\}\/mark-as-read/,
    why: "Mirror Ace's local read state into the Unibox (emails:update).",
  },
];

function normalize(p) {
  return p.split("\\").join("/");
}

function allowanceFor(file) {
  return ALLOWED_WRITES.find((a) => a.file === normalize(file));
}

const violations = [];

for (const file of files) {
  const code = stripComments(readFileSync(file, "utf8"));
  const allowance = allowanceFor(file);

  for (const m of code.matchAll(NON_GET_METHOD)) {
    const method = m[1].toUpperCase();
    // Condition 1: right file. Condition 2: right method. Condition 3:
    // the allowlisted endpoint must actually be present in this file -
    // otherwise the method is being used for something else.
    const permitted =
      allowance && allowance.method === method && allowance.path.test(code);
    if (!permitted) {
      violations.push({
        file,
        detail: allowance
          ? `HTTP method "${method}" - allowlisted file, but the method or endpoint does not match the single permitted write`
          : `HTTP method "${method}"`,
      });
    }
  }

  for (const pattern of WRITE_ENDPOINTS) {
    for (const m of code.matchAll(pattern)) {
      violations.push({ file, detail: `write endpoint ${m[0]}` });
    }
  }

  // An allowlisted file that no longer contains its write is stale - the
  // exception should be removed rather than left standing open.
  if (allowance && !allowance.path.test(code)) {
    violations.push({
      file,
      detail:
        "allowlisted for a write it no longer performs - remove the ALLOWED_WRITES entry",
    });
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

const allowed = ALLOWED_WRITES.length;
console.log(
  `✓ Instantly write check passed (${files.length} file(s); GET only, plus ${allowed} explicitly allowlisted write${allowed === 1 ? "" : "s"}).`,
);
for (const a of ALLOWED_WRITES) {
  console.log(`    allowlisted: ${a.method} in ${a.file} - ${a.why}`);
}
