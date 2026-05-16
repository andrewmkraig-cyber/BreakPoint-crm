// One-shot migration: moves inline CandidateResume bytes (data,
// redactedData) to Vercel Blob, sets blobUrl/redactedBlobUrl, and
// nulls the inline columns.
//
// Idempotent — only touches rows where the corresponding blobUrl is
// still null. Safe to re-run after a partial failure.
//
// Run: npx tsx scripts/backfill-resume-blobs.ts
//
// Requires BLOB_READ_WRITE_TOKEN and DATABASE_URL in the environment
// (loaded from .env.local in the standard dev shell pattern).

import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";

const prisma = new PrismaClient();

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
      console.log(`[data] ${n}/${total}: ${row.id} — skipped (empty buffer)`);
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
      console.error(`[data] ${n}/${total}: ${row.id} — ERROR ${msg}`);
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
      console.log(`[redactedData] ${n}/${total}: ${row.id} — skipped (empty buffer)`);
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
      console.error(`[redactedData] ${n}/${total}: ${row.id} — ERROR ${msg}`);
    }
  }
  return counts;
}

async function main() {
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
