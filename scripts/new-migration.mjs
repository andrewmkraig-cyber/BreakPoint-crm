#!/usr/bin/env node
// Creates a new Prisma migration file from whatever you just changed in
// prisma/schema.prisma. Writes a .sql file and NOTHING ELSE - it does not
// touch the database. `npm run db:deploy` is the separate step that applies it.
//
// Why this exists instead of `prisma migrate dev`:
// Ace has ONE database, and it is production. `migrate dev` is built for a
// throwaway development database - it spins up a shadow database and, if it
// ever detects drift, it offers to RESET the database it is pointed at. That
// prompt must never appear next to live placements and invoices. This script
// does the half of `migrate dev` that is safe (generate the SQL) and leaves
// applying it to `prisma migrate deploy`, which can never reset anything.
//
// Usage: npm run db:migrate -- add-stage-moved-at

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");

// Prisma's CLI reads .env, not .env.local (that's a Next.js convention), so
// load .env.local ourselves and hand the values to the child process.
function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

const rawName = process.argv.slice(2).join(" ").trim();
if (!rawName) {
  fail(
    "Give the migration a short name.\n" +
      "  Example: npm run db:migrate -- add-stage-moved-at",
  );
}

const name = rawName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");
if (!name) fail("That name has no usable characters in it. Use letters and numbers.");

const env = { ...loadEnvLocal(), ...process.env };
const directUrl = env.DIRECT_URL || env.DATABASE_URL;
if (!directUrl) {
  fail("No DIRECT_URL or DATABASE_URL found. Check .env.local.");
}
if (directUrl.includes("-pooler")) {
  fail(
    "DIRECT_URL is pointing at the Neon POOLER endpoint.\n" +
      "  Migrations need the direct endpoint: same URL with '-pooler' removed\n" +
      "  from the host. Fix DIRECT_URL in .env.local and run this again.",
  );
}

console.log("\n  Comparing the live database against prisma/schema.prisma...");

let sql;
try {
  sql = execFileSync(
    "npx",
    [
      "prisma",
      "migrate",
      "diff",
      "--from-url",
      directUrl,
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  fail(`Could not read the database schema.\n  ${e.stderr || e.message}`);
}

if (/^\s*--\s*This is an empty migration\.\s*$/m.test(sql) || !sql.trim()) {
  console.log(
    "\n  No schema changes found. The database already matches schema.prisma,\n" +
      "  so there is nothing to migrate.\n",
  );
  process.exit(0);
}

// Prisma orders migrations by folder name, so the timestamp prefix has to
// match its format exactly: YYYYMMDDHHMMSS in UTC.
const d = new Date();
const stamp =
  String(d.getUTCFullYear()) +
  String(d.getUTCMonth() + 1).padStart(2, "0") +
  String(d.getUTCDate()).padStart(2, "0") +
  String(d.getUTCHours()).padStart(2, "0") +
  String(d.getUTCMinutes()).padStart(2, "0") +
  String(d.getUTCSeconds()).padStart(2, "0");

const dir = path.join(MIGRATIONS_DIR, `${stamp}_${name}`);
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "migration.sql");
fs.writeFileSync(file, sql);

const rel = path.relative(ROOT, file);
const destructive = /\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i.test(sql);

console.log(`\n  Created ${rel}\n`);
console.log("  ----- the SQL that will run -----");
console.log(
  sql
    .trimEnd()
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n"),
);
console.log("  ---------------------------------\n");

if (destructive) {
  console.log(
    "  WARNING: this migration drops a table or a column, which deletes data.\n" +
      "  Read it again before deploying. If that is not what you meant, delete\n" +
      `  the folder ${path.relative(ROOT, dir)} and fix schema.prisma.\n`,
  );
}

console.log("  Nothing has been applied yet. When the SQL above looks right:");
console.log("      npm run db:deploy\n");
