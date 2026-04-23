// One-shot backfill: pulls RF candidates and populates the extra columns
// added in Phase 1 (tags, expectedSalary, raw) on the matching Neon
// Candidate rows. Idempotent: each update only runs when any of the three
// target fields differs from what's already stored.
//
// Usage:
//   DATABASE_URL=<url> npx tsx scripts/backfill-candidate-extras.ts
//
// Phase 5 deletes this script alongside the RF wrapper.

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { recruiterflow, type RFCandidate } from "../src/lib/recruiterflow";

function normalizeTags(c: RFCandidate): string[] {
  const out = new Set<string>();
  const push = (t: unknown) => {
    if (!t) return;
    const name = typeof t === "string" ? t : typeof (t as { name?: string }).name === "string" ? (t as { name: string }).name : "";
    if (name) out.add(name.trim());
  };
  (c.tags ?? []).forEach(push);
  (c.attributes ?? []).forEach(push);
  return Array.from(out).filter(Boolean);
}

function normalizeExpectedSalary(c: RFCandidate): Prisma.InputJsonValue | null {
  const es = (c as { expected_salary?: unknown }).expected_salary;
  if (!es || typeof es !== "object") return null;
  return es as Prisma.InputJsonValue;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main(): Promise<void> {
  console.log("\n=== Candidate extras backfill ===\n");

  const rfCandidates = await recruiterflow.listAllCandidates({ perPage: 100 });
  console.log(`Fetched ${rfCandidates.length} RF candidates`);

  const existing = await prisma.candidate.findMany({
    where: { rfId: { not: null } },
    select: { id: true, rfId: true, tags: true, expectedSalary: true, raw: true },
  });
  const byRfId = new Map(existing.map((r) => [r.rfId as number, r]));

  let updated = 0;
  let skipped = 0;
  let unmapped = 0;

  for (const c of rfCandidates) {
    const prev = byRfId.get(c.id);
    if (!prev) {
      unmapped += 1;
      continue;
    }
    const nextTags = normalizeTags(c);
    const nextSalary = normalizeExpectedSalary(c);
    const nextRaw = c as unknown as Prisma.InputJsonValue;

    const tagsSame = arrayEq(prev.tags, nextTags);
    const salarySame = stableStringify(prev.expectedSalary ?? null) === stableStringify(nextSalary);
    const rawSame = stableStringify(prev.raw ?? null) === stableStringify(nextRaw);

    if (tagsSame && salarySame && rawSame) {
      skipped += 1;
      continue;
    }

    await prisma.candidate.update({
      where: { id: prev.id },
      data: {
        tags: nextTags,
        expectedSalary: nextSalary ?? Prisma.JsonNull,
        raw: nextRaw,
      },
    });
    updated += 1;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  ~${updated} updated`);
  console.log(`  =${skipped} unchanged`);
  console.log(`  ?${unmapped} RF candidates without a matching Neon row (expected 0 after Phase 0)`);
  console.log(`\n✅ Done.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
