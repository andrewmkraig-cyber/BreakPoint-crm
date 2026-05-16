// Backfill CandidateResume.extractedText from the stored PDF bytes
// (CandidateResume.data) using pdf-parse. Idempotent — only touches
// rows where extractedText IS NULL, so a re-run after a crash picks up
// where the last run left off.
//
// Cap is 50,000 chars to mirror src/lib/resume-fallback.ts; oversized
// resumes (rare) get truncated rather than rejected so we always have
// at least the first ~10 pages of searchable text. PDFs that fail to
// parse get a single-space sentinel written so the row stops being
// re-tried on every run.
//
// Run: npx tsx scripts/extract-resume-text.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_SIZE = 10;
const DELAY_MS = 500;
const MAX_CHARS = 50_000;

// Postgres rejects NUL bytes (0x00) inside text columns even when the
// rest of the payload is valid UTF-8 — PDFs routinely include them via
// font-encoding artifacts. We also strip the other unprintable control
// characters (keeping \t \n \r) so the cached text stays clean for
// downstream contains-search and snippet rendering.
function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

async function extractPdfText(data: Buffer): Promise<string | null> {
  // pdf-parse v2 is class-based: instantiate with the byte buffer
  // (converted to Uint8Array), call getText(), then destroy() to free
  // the underlying pdf.js worker handle so we don't leak between rows.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  });
  try {
    const result = await parser.getText();
    const raw = (result.text ?? "").trim();
    if (!raw) return null;
    return sanitize(raw).slice(0, MAX_CHARS);
  } catch {
    return null;
  } finally {
    try {
      await parser.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const total = await prisma.candidateResume.count({
    where: { extractedText: null },
  });
  console.log(`Found ${total} resumes pending extraction.`);
  if (total === 0) {
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let extracted = 0;
  let empty = 0;
  let failed = 0;

  // Loop until no more rows. Each iteration re-queries because we just
  // updated some rows; the WHERE clause naturally shrinks the working
  // set. Using `take` + sleep keeps us under any Neon connection
  // pressure on the shared pooler.
  while (true) {
    const batch = await prisma.candidateResume.findMany({
      where: { extractedText: null },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        data: true,
      },
      take: BATCH_SIZE,
      orderBy: { uploadedAt: "asc" },
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      processed += 1;
      if (!row.data) continue;
      const isPdf =
        (row.mimeType ?? "").toLowerCase().includes("pdf") ||
        row.filename.toLowerCase().endsWith(".pdf");
      let text: string | null = null;
      if (isPdf) text = await extractPdfText(Buffer.from(row.data));

      if (text && text.length > 0) {
        await prisma.candidateResume.update({
          where: { id: row.id },
          data: { extractedText: text },
        });
        extracted += 1;
      } else if (isPdf) {
        // Parse failed — write a single space so we don't retry every
        // run. Non-PDFs (rare DOC/DOCX uploads) get the same sentinel.
        await prisma.candidateResume.update({
          where: { id: row.id },
          data: { extractedText: " " },
        });
        failed += 1;
      } else {
        await prisma.candidateResume.update({
          where: { id: row.id },
          data: { extractedText: " " },
        });
        empty += 1;
      }
    }

    console.log(
      `Processed ${processed}/${total} — extracted=${extracted}, failed=${failed}, non-pdf=${empty}`,
    );
    await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. Total processed: ${processed}. Extracted: ${extracted}. Failed: ${failed}. Non-PDF: ${empty}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
