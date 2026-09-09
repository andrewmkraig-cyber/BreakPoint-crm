// One-shot backfill: fill Client.paymentTermsDays from the payment-terms line
// already sitting in each signed agreement's stored summary.
//
// Why this exists: summarizeAgreement auto-applies the detected payable window
// to the client, but only write-if-empty and only from the moment that
// auto-apply shipped. Agreements summarized before then left the column null,
// so every invoice for those clients falls back to a generic Net 30 even
// though Ace can already show you "Net 10" on the agreements tab.
//
// Dry run by default. Pass --apply to write. Only ever fills a NULL column, so
// a recruiter-set value is never overwritten - the same rule summarizeAgreement
// follows.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-client-payment-terms.ts
//   npx tsx --env-file=.env.local scripts/backfill-client-payment-terms.ts --apply
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

// Lines describing a fee SPLIT between agencies ("remits the other party's fee
// share within 5 business days after receipt") are not a client payable window.
// Parsing them would set a wrong, invoice-facing number, so they are reported
// and skipped rather than guessed at.
const NOT_A_CLIENT_PAYABLE = /fee share|receiving party|split|after receipt of client payment/i;

function parsePayableDays(summary: string): { days: number | null; line: string | null; skipped: boolean } {
  const line = summary
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /payment terms/i.test(l));
  if (!line) return { days: null, line: null, skipped: false };
  if (NOT_A_CLIENT_PAYABLE.test(line)) return { days: null, line, skipped: true };
  const match = line.match(/(\d+)\s*(?:calendar\s+|business\s+)?days?/i) ?? line.match(/net\s*(\d+)/i);
  if (!match) return { days: null, line, skipped: false };
  const n = parseInt(match[1]!, 10);
  return { days: Number.isFinite(n) && n >= 0 && n <= 365 ? n : null, line, skipped: false };
}

async function main(): Promise<void> {
  const agreements = await prisma.clientAgreement.findMany({
    where: { summary: { not: null }, clientId: { not: null } },
    select: { clientId: true, filename: true, summary: true, uploadedAt: true },
    orderBy: { uploadedAt: "desc" },
  });

  // Newest agreement per client wins; the list above is already newest-first.
  const bestByClient = new Map<string, { days: number; line: string; filename: string }>();
  const skipped: Array<{ clientId: string; line: string }> = [];
  const unparsed: Array<{ clientId: string; line: string }> = [];
  for (const a of agreements) {
    if (!a.clientId || bestByClient.has(a.clientId)) continue;
    const { days, line, skipped: isSplit } = parsePayableDays(a.summary ?? "");
    if (isSplit && line) {
      skipped.push({ clientId: a.clientId, line });
      continue;
    }
    if (days == null) {
      if (line) unparsed.push({ clientId: a.clientId, line });
      continue;
    }
    bestByClient.set(a.clientId, { days, line: line ?? "", filename: a.filename });
  }

  const clientIds = Array.from(bestByClient.keys());
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, name: true, paymentTermsDays: true },
  });

  const toWrite: Array<{ id: string; name: string; days: number; line: string }> = [];
  const alreadySet: Array<{ name: string; current: number; detected: number }> = [];
  for (const c of clients) {
    const hit = bestByClient.get(c.id);
    if (!hit) continue;
    if (c.paymentTermsDays != null) {
      alreadySet.push({ name: c.name, current: c.paymentTermsDays, detected: hit.days });
      continue;
    }
    toWrite.push({ id: c.id, name: c.name, days: hit.days, line: hit.line });
  }

  console.log(APPLY ? "APPLY - writing changes" : "DRY RUN - nothing will be written");
  console.log(`\nWould set paymentTermsDays on ${toWrite.length} client(s):`);
  toWrite
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((c) => {
      console.log(`  ${c.name} -> Net ${c.days}`);
      console.log(`      from: ${c.line.slice(0, 120)}`);
    });

  if (alreadySet.length > 0) {
    console.log(`\nAlready set, left untouched (${alreadySet.length}):`);
    alreadySet.forEach((c) =>
      console.log(`  ${c.name}: keeping Net ${c.current} (agreement said Net ${c.detected})`),
    );
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped - reads like a fee split, not a client payable (${skipped.length}):`);
    skipped.forEach((s) => console.log(`  ${s.clientId}: ${s.line.slice(0, 120)}`));
  }
  if (unparsed.length > 0) {
    console.log(`\nHad a terms line but no day count (${unparsed.length}):`);
    unparsed.forEach((s) => console.log(`  ${s.clientId}: ${s.line.slice(0, 120)}`));
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to write these values.");
    await prisma.$disconnect();
    return;
  }

  for (const c of toWrite) {
    await prisma.client.update({
      where: { id: c.id },
      data: { paymentTermsDays: c.days },
    });
    console.log(`  wrote ${c.name} -> Net ${c.days}`);
  }
  console.log(`\nDone. ${toWrite.length} client(s) updated.`);
  await prisma.$disconnect();
}

void main();
