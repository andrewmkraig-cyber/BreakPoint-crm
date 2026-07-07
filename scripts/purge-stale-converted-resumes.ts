// Delete CandidateResume rows created by the old DOCX plain-text reflow
// fallback. These rows are lossy PDFs and must not be reused as the
// formatting-preserving CloudConvert cache.
//
// Dry-run by default — prints what would be deleted without touching the DB.
// Pass --apply to execute the deletes.
//
// Run: npx tsx scripts/purge-stale-converted-resumes.ts [--apply]
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  console.log(`[purge-converted] mode: ${apply ? "APPLY (deleting rows)" : "DRY RUN (no changes)"}`);

  const rows = await prisma.candidateResume.findMany({
    where: {
      OR: [
        { variant: "converted" },
        { displayName: "Converted (fallback)" },
        {
          variant: { startsWith: "converted:" },
          NOT: { displayName: "Converted (CloudConvert)" },
        },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      candidateId: true,
      candidateRfId: true,
      filename: true,
      displayName: true,
      variant: true,
      size: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: "asc" },
  });

  if (rows.length === 0) {
    console.log("[purge-converted] no converted rows found — nothing to do.");
    return;
  }

  console.log(`[purge-converted] found ${rows.length} converted row(s):`);
  for (const r of rows) {
    console.log(
      `  id=${r.id}  org=${r.organizationId}  candidateId=${r.candidateId ?? "—"}` +
        `  rfId=${r.candidateRfId ?? "—"}  variant=${r.variant ?? "—"}` +
        `  display=${r.displayName ?? "—"}  file=${r.filename}` +
        `  size=${r.size}  uploaded=${r.uploadedAt.toISOString()}`,
    );
  }

  if (!apply) {
    console.log("\n[purge-converted] dry run complete. Pass --apply to delete these rows.");
    return;
  }

  const ids = rows.map((r) => r.id);
  const result = await prisma.candidateResume.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(`\n[purge-converted] deleted ${result.count} row(s).`);
}

main()
  .catch((err) => {
    console.error("[purge-converted] error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
