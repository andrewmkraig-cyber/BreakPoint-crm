// One-shot migration: moves inline CandidateResume bytes (data,
// redactedData) to Vercel Blob, sets blobUrl/redactedBlobUrl, and
// nulls the inline columns.
//
// Idempotent - only touches rows where the corresponding blobUrl is
// still null. Safe to re-run after a partial failure.
//
// Run:     npx tsx scripts/backfill-resume-blobs.ts
// Preview: npx tsx scripts/backfill-resume-blobs.ts --dry-run
//
// --dry-run lists every row that WOULD move, with its size, and
// writes nothing - no Blob upload, no UPDATE. It reads sizes via
// octet_length() rather than selecting the bytes, so previewing a
// 50MB backlog costs one cheap aggregate instead of a full download.
//
// Requires BLOB_READ_WRITE_TOKEN and DATABASE_URL in the environment
// (loaded from .env.local in the standard dev shell pattern).

import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

type Counts = { migrated: number; errors: number; skipped: number };

async function migrateData(): Promise<Counts> {
  const rows = await prisma.candidateResume.findMany({
    where: { blobUrl: null, data: { not: null } },
    select: {
      id: true,
      candidateId: true,
      filename: true,
      mimeType: true,
      data: true,
    },
  });
  const total = rows.length;
  console.log(`\n[data] ${total} rows to consider for blobUrl backfill.`);
  const counts: Counts = { migrated: 0, errors: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = i + 1;
    if (!row.data || row.data.byteLength === 0) {
      counts.skipped += 1;
      console.log(`[data] ${n}/${total}: ${row.id} - skipped (empty buffer)`);
      continue;
    }
    try {
      const candidateIdForPath = row.candidateId ?? row.id;
      const blob = await put(
        `resumes/${candidateIdForPath}/backfill-${row.filename}`,
        Buffer.from(row.data),
        { access: "private", contentType: row.mimeType, addRandomSuffix: true },
      );
      await prisma.candidateResume.update({
        where: { id: row.id },
        data: { blobUrl: blob.url, data: null },
      });
      counts.migrated += 1;
      console.log(`[data] ${n}/${total}: ${row.id} → ${blob.url}`);
    } catch (e) {
      counts.errors += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[data] ${n}/${total}: ${row.id} - ERROR ${msg}`);
    }
  }
  return counts;
}

async function migrateRedactedData(): Promise<Counts> {
  const rows = await prisma.candidateResume.findMany({
    where: { redactedBlobUrl: null, redactedData: { not: null } },
    select: {
      id: true,
      candidateId: true,
      filename: true,
      redactedMimeType: true,
      redactedData: true,
    },
  });
  const total = rows.length;
  console.log(`\n[redactedData] ${total} rows to consider for redactedBlobUrl backfill.`);
  const counts: Counts = { migrated: 0, errors: 0, skipped: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = i + 1;
    if (!row.redactedData || row.redactedData.byteLength === 0) {
      counts.skipped += 1;
      console.log(`[redactedData] ${n}/${total}: ${row.id} - skipped (empty buffer)`);
      continue;
    }
    try {
      const candidateIdForPath = row.candidateId ?? row.id;
      const blob = await put(
        `resumes/${candidateIdForPath}/redacted-backfill-${row.filename}`,
        Buffer.from(row.redactedData),
        {
          access: "private",
          contentType: row.redactedMimeType ?? "application/pdf",
          addRandomSuffix: true,
        },
      );
      await prisma.candidateResume.update({
        where: { id: row.id },
        data: { redactedBlobUrl: blob.url, redactedData: null },
      });
      counts.migrated += 1;
      console.log(`[redactedData] ${n}/${total}: ${row.id} → ${blob.url}`);
    } catch (e) {
      counts.errors += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[redactedData] ${n}/${total}: ${row.id} - ERROR ${msg}`);
    }
  }
  return counts;
}

// Read-only preview of both backfill phases. Mirrors the exact WHERE
// clauses the live migration uses, so what this prints is precisely what
// a real run would touch.
type PlanRow = { id: string; filename: string; bytes: number };

async function planPhase(
  label: string,
  urlCol: "blobUrl" | "redactedBlobUrl",
  dataCol: "data" | "redactedData",
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<PlanRow[]>(
    `SELECT "id", "filename", octet_length("${dataCol}")::int AS bytes
       FROM "CandidateResume"
      WHERE "${urlCol}" IS NULL AND "${dataCol}" IS NOT NULL
      ORDER BY octet_length("${dataCol}") DESC NULLS LAST`,
  );
  const movable = rows.filter((r) => (r.bytes ?? 0) > 0);
  const empty = rows.length - movable.length;
  const total = movable.reduce((sum, r) => sum + r.bytes, 0);

  console.log(`\n[${label}] ${rows.length} row(s) match the migration WHERE clause.`);
  console.log(`[${label}] ${movable.length} would upload, ${empty} would skip (empty buffer).`);
  if (movable.length > 0) {
    console.log(`[${label}] total to transfer: ${(total / 1024 / 1024).toFixed(1)} MB`);
    // Indexed loop, not movable.entries(): tsconfig sets no `target`, so TS
    // defaults to ES5 and rejects iterating an ArrayIterator (TS2802). scripts/
    // is inside the tsconfig `include`, so this fails `next build`, not just
    // a local tsc run.
    movable.forEach((r, i) => {
      const mb = (r.bytes / 1024 / 1024).toFixed(2);
      console.log(`[${label}] ${i + 1}/${movable.length}: ${r.id}  ${mb} MB  ${r.filename}`);
    });
  }
}

async function dryRun() {
  console.log("DRY RUN - no blobs written, no rows updated.");
  await planPhase("data", "blobUrl", "data");
  await planPhase("redactedData", "redactedBlobUrl", "redactedData");
  console.log("\n=== DRY RUN COMPLETE - nothing was changed. ===");
  console.log("Re-run without --dry-run to perform the migration.");
  await prisma.$disconnect();
}

async function main() {
  if (DRY_RUN) {
    await dryRun();
    return;
  }
  console.log("Starting CandidateResume blob backfill...");
  const dataCounts = await migrateData();
  const redactedCounts = await migrateRedactedData();
  console.log("\n=== SUMMARY ===");
  console.log(
    `data:         migrated=${dataCounts.migrated}  errors=${dataCounts.errors}  skipped=${dataCounts.skipped}`,
  );
  console.log(
    `redactedData: migrated=${redactedCounts.migrated}  errors=${redactedCounts.errors}  skipped=${redactedCounts.skipped}`,
  );
  await prisma.$disconnect();
  if (dataCounts.errors > 0 || redactedCounts.errors > 0) {
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
