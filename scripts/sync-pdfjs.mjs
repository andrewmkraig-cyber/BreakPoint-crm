#!/usr/bin/env node
// Copies the pdf.js browser library and its worker from node_modules into
// public/pdfjs so the viewer loads them straight from the site, outside
// webpack. Runs on postinstall so the two files can never drift from the
// installed pdfjs-dist version (or from each other).
//
// Why outside webpack: bundling pdfjs-dist's build/pdf.mjs through Next's
// webpack started throwing "Object.defineProperty called on non-object" at
// module setup (both builds, dev and prod, 2026-11-13), before a line of
// pdf.js ran. Loading the vendor file natively sidesteps the bundler.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "node_modules", "pdfjs-dist", "legacy", "build");
const DEST = path.join(ROOT, "public", "pdfjs");
const FILES = ["pdf.min.mjs", "pdf.worker.min.mjs"];

if (!fs.existsSync(SRC)) {
  console.warn("[sync-pdfjs] pdfjs-dist not installed; skipping");
  process.exit(0);
}
fs.mkdirSync(DEST, { recursive: true });
const version = JSON.parse(
  fs.readFileSync(path.join(ROOT, "node_modules", "pdfjs-dist", "package.json"), "utf8"),
).version;
for (const f of FILES) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
fs.writeFileSync(path.join(DEST, "VERSION"), `${version}\n`);
console.log(`[sync-pdfjs] copied ${FILES.join(", ")} (pdfjs-dist ${version}) to public/pdfjs`);
