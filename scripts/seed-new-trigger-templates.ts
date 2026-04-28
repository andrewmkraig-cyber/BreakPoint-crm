// One-shot: seed the three brand-new template defaults added in 26.0+
// (candidate_applied_confirmation, offer_extended, candidate_hired_welcome).
// ensureDefaultTemplates() is idempotent — only inserts when the trigger
// key isn't already present, so re-running is safe.
import { ensureDefaultTemplates } from "../src/app/settings/templates-actions";
import { prisma } from "../src/lib/prisma";

async function main() {
  await ensureDefaultTemplates();
  const rows = await prisma.emailTemplate.findMany({
    select: { trigger: true, name: true, isActive: true },
    orderBy: { trigger: "asc" },
  });
  console.log("Templates after seed:");
  for (const r of rows) {
    console.log(`  [${r.trigger ?? "(null)"}] ${r.name} active=${r.isActive}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
