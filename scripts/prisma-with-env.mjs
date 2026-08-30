#!/usr/bin/env node
// Runs a `prisma` command with .env.local loaded.
//
// The Prisma CLI reads .env, but Ace keeps its secrets in .env.local (the
// Next.js convention), so DATABASE_URL and DIRECT_URL are invisible to a bare
// `npx prisma ...`. This wrapper loads them first, then hands off.
//
// Usage: node scripts/prisma-with-env.mjs migrate deploy

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

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

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("\n  Nothing to run. Example: node scripts/prisma-with-env.mjs migrate status\n");
  process.exit(1);
}

const env = { ...loadEnvLocal(), ...process.env };

const res = spawnSync("npx", ["prisma", ...args], {
  cwd: ROOT,
  env,
  stdio: "inherit",
});

process.exit(res.status ?? 1);
