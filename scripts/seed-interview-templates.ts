import { ensureDefaultTemplates } from "../src/app/settings/templates-actions";
import { prisma } from "../src/lib/prisma";
import {
  CANDIDATE_INTERVIEW_PREP_TRIGGER,
  CLIENT_INTERVIEW_CONFIRMATION_TRIGGER,
} from "../src/app/settings/template-constants";

async function main() {
  await ensureDefaultTemplates();
  const tpls = await prisma.emailTemplate.findMany({
    where: { trigger: { in: [CLIENT_INTERVIEW_CONFIRMATION_TRIGGER, CANDIDATE_INTERVIEW_PREP_TRIGGER] } },
    select: { id: true, name: true, trigger: true, isActive: true },
  });
  console.log("Seeded interview templates:", tpls);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
