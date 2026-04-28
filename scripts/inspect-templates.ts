import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.emailTemplate.findMany({
    select: { id: true, name: true, trigger: true, isActive: true, createdAt: true, updatedAt: true, body: true },
    orderBy: { trigger: "asc" },
  });
  for (const r of rows) {
    console.log(`[${r.trigger ?? "(null)"}] ${r.name} | active=${r.isActive} | created=${r.createdAt.toISOString()} | updated=${r.updatedAt.toISOString()} | body-len=${r.body.length}`);
  }
}
main().finally(() => prisma.$disconnect());
