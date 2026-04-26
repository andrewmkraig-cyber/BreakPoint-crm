// Diagnostic only — prints the tag-source fields for a single candidate.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npx tsx scripts/inspect-candidate-tags.ts <candidateId>");
    process.exit(1);
  }
  const c = await prisma.candidate.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, tags: true, raw: true },
  });
  if (!c) {
    console.log("not found");
    return;
  }
  console.log(`Candidate: ${c.firstName} ${c.lastName} (${c.id})`);
  console.log(`Candidate.tags column:`, c.tags);
  const raw = c.raw as Record<string, unknown> | null;
  if (raw && typeof raw === "object") {
    console.log(`Candidate.raw.tags:`, raw.tags);
    console.log(`Candidate.raw.attributes:`, raw.attributes);
  } else {
    console.log(`Candidate.raw is null / not object`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
