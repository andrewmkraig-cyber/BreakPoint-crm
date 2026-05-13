import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc";

async function main() {
  const seeds: Array<{
    name: string;
    cost: number;
    frequency: string;
    paidCount: number;
  }> = [
    { name: "Apollo", cost: 500, frequency: "one-time", paidCount: 1 },
    { name: "Pin", cost: 300, frequency: "monthly", paidCount: 2 },
  ];

  for (const s of seeds) {
    const existing = await prisma.toolExpense.findFirst({
      where: { organizationId: DEFAULT_ORG_ID, name: s.name },
    });
    if (existing) {
      console.log(`skip ${s.name} (already seeded id=${existing.id})`);
      continue;
    }
    const row = await prisma.toolExpense.create({
      data: { ...s, organizationId: DEFAULT_ORG_ID },
    });
    console.log(`inserted ${row.name} id=${row.id}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
