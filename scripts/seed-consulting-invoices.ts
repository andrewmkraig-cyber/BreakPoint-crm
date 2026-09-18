// Seeds the consulting_invoices history that predates the feature.
//
// Arfie Management LLC (Andrew): #3 to #8, July 15 to September 18, 2026.
// Branzino Holdings LLC (Austin): #0001, September 18, 2026.
//
// Arfie #1 and #2 are not on record and are NOT seeded; the sequence starts
// at #3 because that is the earliest invoice we have an amount for. Add
// them here if they turn up and re-run - the script is idempotent on
// (org, company, invoiceNumber), so existing rows are skipped, never
// rewritten.
//
// Due dates equal invoice dates (both templates bill due upon receipt).
// emailedAt stays null: these were sent before Ace existed.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/seed-consulting-invoices.ts            # dry run
//   npx tsx scripts/seed-consulting-invoices.ts --apply    # write

import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent

type SeedRow = {
  company: "arfie" | "branzino";
  invoiceNumber: number;
  amount: string;
  date: string; // YYYY-MM-DD
};

const ROWS: SeedRow[] = [
  { company: "arfie", invoiceNumber: 3, amount: "3500.00", date: "2026-07-15" },
  { company: "arfie", invoiceNumber: 4, amount: "3500.00", date: "2026-07-31" },
  { company: "arfie", invoiceNumber: 5, amount: "3750.00", date: "2026-08-13" },
  { company: "arfie", invoiceNumber: 6, amount: "3750.00", date: "2026-08-27" },
  { company: "arfie", invoiceNumber: 7, amount: "3750.00", date: "2026-09-10" },
  { company: "arfie", invoiceNumber: 8, amount: "1500.00", date: "2026-09-18" },
  { company: "branzino", invoiceNumber: 1, amount: "500.00", date: "2026-09-18" },
];

function utcMidnight(iso: string): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date in seed: ${iso}`);
  return d;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const orgId = args.find((a) => a.startsWith("--org="))?.slice("--org=".length) ?? DEFAULT_ORG_ID;

  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} - consulting invoice history for org ${orgId}\n`);

  const existing = await prisma.consultingInvoice.findMany({
    where: { organizationId: orgId },
    select: { company: true, invoiceNumber: true },
  });
  const have = new Set(existing.map((r) => `${r.company}:${r.invoiceNumber}`));

  let toWrite = 0;
  let skipped = 0;
  const totals: Record<string, number> = { arfie: 0, branzino: 0 };

  for (let i = 0; i < ROWS.length; i += 1) {
    const row = ROWS[i]!;
    const key = `${row.company}:${row.invoiceNumber}`;
    const label = `${row.company.padEnd(8)} #${String(row.invoiceNumber).padStart(4, "0")}  $${row.amount.padStart(8)}  ${row.date}`;
    if (have.has(key)) {
      skipped += 1;
      console.log(`  skip   ${label}  (already present)`);
      continue;
    }
    toWrite += 1;
    totals[row.company] = (totals[row.company] ?? 0) + Math.round(Number(row.amount) * 100);
    console.log(`  ${apply ? "write" : "would"}  ${label}`);
    if (apply) {
      await prisma.consultingInvoice.create({
        data: {
          organizationId: orgId,
          company: row.company,
          invoiceNumber: row.invoiceNumber,
          amount: new Prisma.Decimal(row.amount),
          invoiceDate: utcMidnight(row.date),
          dueDate: utcMidnight(row.date),
        },
      });
    }
  }

  console.log(
    `\n  ${apply ? "wrote" : "would write"} ${toWrite}, skipped ${skipped}` +
      `  (new Arfie $${(totals.arfie / 100).toFixed(2)}, new Branzino $${(totals.branzino / 100).toFixed(2)})\n`,
  );

  if (apply) {
    const all = await prisma.consultingInvoice.findMany({
      where: { organizationId: orgId },
      select: { company: true, amount: true },
    });
    const sum: Record<string, number> = { arfie: 0, branzino: 0 };
    all.forEach((r) => {
      sum[r.company] = (sum[r.company] ?? 0) + Math.round(Number(r.amount.toString()) * 100);
    });
    console.log(
      `  table totals now: Arfie $${(sum.arfie / 100).toFixed(2)}, Branzino $${(sum.branzino / 100).toFixed(2)}\n`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
