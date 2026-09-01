// READ-ONLY integrity report: clients whose invoiced total exceeds the fee
// recorded on their placements.
//
// Writes NOTHING. There is no --apply flag and no code path here mutates a
// row. This is a list for Andrew to reconcile by hand.
//
// WHAT IT LOOKS FOR. `earned` (the pacing figure as of Ace 99.0) sums
// Placement.feeTotal; `billed` sums Invoice.feeAmount. In normal operation
// earned >= billed, because you book the work before you invoice it. A
// client where the invoices come to MORE than the placements' recorded fee
// means one of:
//   - a placement's feeTotal was never filled in, or was set low
//   - a second invoice was raised against the same placement
//   - an invoice is attached to the wrong client
// The engine already flags this per-window via `billedExceedsEarned`; this
// script finds every instance across the whole org, all time.
//
// DENOMINATOR is deliberately generous: every non-cancelled, non-rejected
// placement counts toward feeTotal, including ones with no placedAt yet.
// A row that still shows a gap is therefore a real gap, not an artifact of
// a placement that has not closed.
//
// RETAINED INVOICES ARE EXCLUDED. A retained engagement bills on the
// RetainedSearch before any candidate exists and has no placement behind it
// by design (Ace 97.0), so counting those would flag every retained client
// falsely.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/report-invoice-fee-gaps.ts
//   npx tsx scripts/report-invoice-fee-gaps.ts --org=<cuid>

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent

const DEAD_STAGES = ["cancelled", "rejected"];

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

async function main(): Promise<void> {
  let orgId = DEFAULT_ORG_ID;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--org=")) orgId = a.slice("--org=".length);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`No organization ${orgId}`);

  const [clients, placementGroups, invoiceGroups] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    }),
    prisma.placement.groupBy({
      by: ["clientId"],
      where: { organizationId: orgId, stage: { notIn: DEAD_STAGES } },
      _sum: { feeTotal: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["clientId"],
      where: {
        organizationId: orgId,
        status: { in: ["SENT", "PAID"] },
        retainedSearchId: null,
      },
      _sum: { feeAmount: true },
      _count: { _all: true },
    }),
  ]);

  const feeByClient = new Map<string, { fee: number; count: number }>();
  for (const g of placementGroups) {
    if (!g.clientId) continue;
    feeByClient.set(g.clientId, { fee: num(g._sum.feeTotal), count: g._count._all });
  }
  const invByClient = new Map<string, { total: number; count: number }>();
  for (const g of invoiceGroups) {
    if (!g.clientId) continue;
    invByClient.set(g.clientId, { total: num(g._sum.feeAmount), count: g._count._all });
  }

  type Row = {
    name: string;
    placements: number;
    feeTotal: number;
    invoiceTotal: number;
    invoiceCount: number;
    gap: number;
  };
  const rows: Row[] = [];
  for (const c of clients) {
    const p = feeByClient.get(c.id) ?? { fee: 0, count: 0 };
    const i = invByClient.get(c.id) ?? { total: 0, count: 0 };
    const gap = i.total - p.fee;
    if (gap > 0) {
      rows.push({
        name: c.name,
        placements: p.count,
        feeTotal: p.fee,
        invoiceTotal: i.total,
        invoiceCount: i.count,
        gap,
      });
    }
  }
  rows.sort((a, b) => b.gap - a.gap);

  console.log(`\nINVOICED-ABOVE-EARNED REPORT - ${org.name} (${org.id})`);
  console.log("Read-only. Nothing was written.\n");

  if (rows.length === 0) {
    console.log("No clients invoice above their placements' recorded fee.\n");
    await printRetainedContext(orgId);
    return;
  }

  console.log(
    `${"Client".padEnd(34)}${"Placements".padStart(11)}${"Sum feeTotal".padStart(14)}${"Invoiced".padStart(12)}${"Gap".padStart(12)}`,
  );
  console.log("-".repeat(83));
  for (const r of rows) {
    console.log(
      r.name.slice(0, 33).padEnd(34) +
        String(r.placements).padStart(11) +
        usd.format(r.feeTotal).padStart(14) +
        `${usd.format(r.invoiceTotal)} (${r.invoiceCount})`.padStart(12) +
        usd.format(r.gap).padStart(12),
    );
  }
  const totalGap = rows.reduce((s, r) => s + r.gap, 0);
  console.log("-".repeat(83));
  console.log(
    `${rows.length} client(s) to reconcile`.padEnd(59) + `total gap ${usd.format(totalGap)}`,
  );
  await printRetainedContext(orgId);
  console.log("\nRead-only. No rows were created, updated or deleted.\n");
}

// Retained invoices are excluded from the gap maths above because they are
// SUPPOSED to have no placement behind them. They are listed here so a zero
// gap is legible rather than mysterious: this is the money that looks like
// an over-invoice until you know it is a retainer.
//
// It also makes visible the one real asymmetry in the model: `earned` (the
// pacing figure as of Ace 99.0) excludes retained money entirely, so every
// dollar below is counted in billed and collected but NOT in the number the
// desk is now paced against.
async function printRetainedContext(orgId: string): Promise<void> {
  const retained = await prisma.invoice.findMany({
    where: {
      organizationId: orgId,
      status: { in: ["SENT", "PAID"] },
      retainedSearchId: { not: null },
    },
    select: { invoiceNumber: true, status: true, feeAmount: true, clientId: true },
  });
  if (retained.length === 0) return;

  const names = new Map(
    (
      await prisma.client.findMany({
        where: { id: { in: retained.map((r) => r.clientId).filter(Boolean) as string[] } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );

  console.log("\nCONTEXT - retained invoices, excluded from the gap maths above.");
  console.log("These correctly have no placement behind them (Ace 97.0), so they are");
  console.log("NOT gaps. They are also invisible to `earned`, the pacing figure.");
  let total = 0;
  for (const r of retained) {
    total += num(r.feeAmount);
    console.log(
      `  ${(names.get(r.clientId ?? "") ?? "(no client)").slice(0, 33).padEnd(34)}` +
        `${r.invoiceNumber.padEnd(10)}${r.status.padEnd(6)}${usd.format(num(r.feeAmount)).padStart(10)}`,
    );
  }
  console.log(`  ${"".padEnd(34)}${"".padEnd(16)}${usd.format(total).padStart(10)} not in earned`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
