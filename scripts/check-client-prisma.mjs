#!/usr/bin/env node
// Build gate: no "use client" component may reach @/lib/prisma.
//
// WHY THIS EXISTS. src/lib/prisma.ts calls `base.$extends(...)` at MODULE
// SCOPE. In a browser bundle `@prisma/client` resolves to a shim whose
// PrismaClient is a Proxy that throws on any property access, so that
// $extends read throws the moment the module is evaluated:
//
//   "PrismaClient is unable to run in this browser environment, or has
//    been bundled for the browser"
//
// It is invisible to `next build` (which exits 0), invisible to SSR
// (the server render is fine), and only fires at browser hydration - so a
// curl or an HTTP 200 check will not catch it. It shipped to production
// twice: once via src/app/dashboard/goals-period.ts importing etWindow
// from metrics.ts, and once via the Instantly settings view importing a
// constant from a module that reaches preferences -> prisma
// (Sentry ACE-CRM-1Y, 2026-09-01).
//
// The fix in both cases was the same: put the pure helpers in a module
// that does not reach prisma, and re-export them from the server-side one.
//
// Two things are deliberately NOT flagged:
//   - "use server" modules. Next replaces those imports with an RPC stub,
//     so they are never bundled to the browser.
//   - `import type` / type-only specifiers, which are erased at build time.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(SRC);

const read = (f) => fs.readFileSync(f, "utf8");
const isClient = (f) => /^\s*["']use client["']/.test(read(f).slice(0, 200));
// A "use server" module is NEVER bundled into the browser - Next replaces the
// import with an RPC stub - so it cannot carry prisma into a client chunk.
const isServerAction = (f) => /^\s*["']use server["']/.test(read(f).slice(0, 200));

function resolve(spec, from) {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : path.resolve(path.dirname(from), spec);
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Only VALUE imports matter - `import type` is erased at build time.
function valueImports(f) {
  const src = read(f);
  const out = [];
  const re = /import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1];
    // A clause that is ONLY type specifiers is also erased.
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named && !/^\s*$/.test(named[1])) {
      const specs = named[1].split(",").map((s) => s.trim()).filter(Boolean);
      const hasValue = specs.some((s) => !s.startsWith("type "));
      const hasDefaultOrNs = /^\s*[A-Za-z_$]/.test(clause);
      if (!hasValue && !hasDefaultOrNs) continue;
    }
    out.push(m[2]);
  }
  // bare `import "x"` side-effect imports
  const re2 = /import\s+["']([^"']+)["']/g;
  while ((m = re2.exec(src))) out.push(m[1]);
  return out;
}

const TARGETS = new Set([path.join(SRC, "lib", "prisma.ts")]);

function chainToPrisma(entry) {
  const seen = new Set();
  const stack = [[entry, [entry]]];
  while (stack.length) {
    const [f, chain] = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of valueImports(f)) {
      if (spec === "@prisma/client") {
        // enums only: pulls the browser build but never constructs a client
        continue;
      }
      const r = resolve(spec, f);
      if (!r) continue;
      if (isServerAction(r)) continue;
      if (TARGETS.has(r)) return [...chain, r];
      stack.push([r, [...chain, r]]);
    }
  }
  return null;
}

const rel = (f) => path.relative(ROOT, f);
let bad = 0;
for (const f of files) {
  if (!isClient(f)) continue;
  const chain = chainToPrisma(f);
  if (chain) {
    bad++;
    console.error("CLIENT COMPONENT REACHES @/lib/prisma:");
    console.error("  " + chain.map(rel).join("\n    -> "));
  }
}
if (bad === 0) {
  console.log("\u2713 Client/prisma check passed (no client component reaches @/lib/prisma).");
  process.exit(0);
}
console.error(
  `\n\u2716 ${bad} client component(s) reach @/lib/prisma.\n\n` +
    "  Move the pure helpers into a module that does not import prisma and\n" +
    "  re-export them from the server-side module. Never fix this by making\n" +
    "  the client component a server one just to silence the check.\n",
);
process.exit(1);
