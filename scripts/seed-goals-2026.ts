// Seeds the 2026 company goals for BreakPoint Talent.
//
// What it writes (10 rows, all scope COMPANY, all status ACTIVE):
//   - 1 ANNUAL  REVENUE        2026            target 500,000, escalationPct 15
//   - 4 QUARTERLY REVENUE      2026 Q1-Q4      target 125,000 each, parented
//                                              to the annual revenue goal
//   - 4 QUARTERLY SIGNED_CLIENTS 2026 Q1-Q4    target 9 each
//   - 1 MILESTONE REVENUE      no period       target 150,000 (lifetime)
//
// Idempotent. Goal has no unique constraint to upsert against, so a row's
// identity here is its natural key - (organizationId, scope, ownerUserId,
// metric, period, periodStart, periodEnd). Anything already matching that
// key is left exactly as it is; only genuinely missing rows are created.
// A second --apply run is a clean no-op.
//
// It does repair one thing: a quarterly revenue goal that exists but has no
// parentGoalId (a half-finished earlier run) gets linked to the annual. That
// is reported separately from a create so the output never implies more
// happened than did.
//
// Usage from repo root:
//   set -a && source .env.local && set +a
//   npx tsx scripts/seed-goals-2026.ts            # dry run, writes nothing
//   npx tsx scripts/seed-goals-2026.ts --apply    # write
//   npx tsx scripts/seed-goals-2026.ts --org=<cuid> --apply

import { GoalMetric, GoalPeriod, GoalScope, GoalStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "cmobj8dxz00012gliequ53kvc"; // BreakPoint Talent
const OWNER_EMAIL = "andrew@breakpointtalent.com";
const YEAR = 2026;

// Period bounds are UTC and INCLUSIVE on both ends: the first instant of the
// first day through the last instant of the last day. Every range query
// against these goals can then be a plain periodStart <= d <= periodEnd
// without an off-by-one at the quarter boundary.
function startOfDayUtc(y: number, month1: number, day: number): Date {
  return new Date(Date.UTC(y, month1 - 1, day, 0, 0, 0, 0));
}
function endOfDayUtc(y: number, month1: number, day: number): Date {
  return new Date(Date.UTC(y, month1 - 1, day, 23, 59, 59, 999));
}

const QUARTERS = [
  { label: "Q1", start: startOfDayUtc(YEAR, 1, 1), end: endOfDayUtc(YEAR, 3, 31) },
  { label: "Q2", start: startOfDayUtc(YEAR, 4, 1), end: endOfDayUtc(YEAR, 6, 30) },
  { label: "Q3", start: startOfDayUtc(YEAR, 7, 1), end: endOfDayUtc(YEAR, 9, 30) },
  { label: "Q4", start: startOfDayUtc(YEAR, 10, 1), end: endOfDayUtc(YEAR, 12, 31) },
];

const ANNUAL_START = startOfDayUtc(YEAR, 1, 1);
const ANNUAL_END = endOfDayUtc(YEAR, 12, 31);

const MILESTONE_NOTES =
  "Lifetime cash collected. Ron takes us seriously past this line.";

type Spec = {
  label: string;
  metric: GoalMetric;
  period: GoalPeriod;
  periodStart: Date | null;
  periodEnd: Date | null;
  targetValue: number;
  escalationPct?: number;
  notes?: string;
};

function parseArgs(argv: string[]): { orgId: string; apply: boolean } {
  let orgId = DEFAULT_ORG_ID;
  let apply = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--org=")) orgId = arg.slice("--org=".length);
  }
  return { orgId, apply };
}

// The natural key. ownerUserId is null on every row here (all COMPANY
// scope), and Prisma turns `null` into `IS NULL`, which is what makes the
// milestone row (no period dates) match on a re-run.
function whereFor(orgId: string, spec: Spec) {
  return {
    organizationId: orgId,
    scope: GoalScope.COMPANY,
    ownerUserId: null,
    metric: spec.metric,
    period: spec.period,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
  };
}

function money(n: number): string {
  return n.toLocaleString("en-US");
}

function describe(spec: Spec, parentLabel?: string): string {
  const window =
    spec.periodStart && spec.periodEnd
      ? `${spec.periodStart.toISOString().slice(0, 10)} -> ${spec.periodEnd.toISOString().slice(0, 10)}`
      : "no period (cumulative)";
  const extras: string[] = [];
  if (spec.escalationPct != null) extras.push(`escalationPct ${spec.escalationPct}`);
  if (parentLabel) extras.push(`parent ${parentLabel}`);
  if (spec.notes) extras.push(`notes "${spec.notes}"`);
  return (
    `${spec.label.padEnd(28)} ${spec.period.padEnd(9)} ${spec.metric.padEnd(15)} ` +
    `target ${money(spec.targetValue).padStart(8)}  ${window}` +
    (extras.length ? `  [${extras.join(", ")}]` : "")
  );
}

async function main(): Promise<void> {
  const { orgId, apply } = parseArgs(process.argv);
  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} - seeding ${YEAR} goals for org ${orgId}\n`);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`No organization ${orgId} - aborting, nothing written.`);

  // Every goal needs a creator. Company goals are the owner's, and the
  // owner is also the approver, so ACTIVE company rows are not left with an
  // empty approver.
  const owner = await prisma.user.findFirst({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error(`No user found for ${OWNER_EMAIL} - aborting, nothing written.`);
  const creatorId = owner.id;

  console.log(`Org:     ${org.name} (${org.id})`);
  console.log(`Creator: ${owner.email} (${owner.id})\n`);

  const annualSpec: Spec = {
    label: `${YEAR} annual revenue`,
    metric: GoalMetric.REVENUE,
    period: GoalPeriod.ANNUAL,
    periodStart: ANNUAL_START,
    periodEnd: ANNUAL_END,
    targetValue: 500_000,
    escalationPct: 15,
  };

  const quarterlyRevenue: Spec[] = QUARTERS.map((q) => ({
    label: `${YEAR} ${q.label} revenue`,
    metric: GoalMetric.REVENUE,
    period: GoalPeriod.QUARTERLY,
    periodStart: q.start,
    periodEnd: q.end,
    targetValue: 125_000,
  }));

  const quarterlySignedClients: Spec[] = QUARTERS.map((q) => ({
    label: `${YEAR} ${q.label} signed clients`,
    metric: GoalMetric.SIGNED_CLIENTS,
    period: GoalPeriod.QUARTERLY,
    periodStart: q.start,
    periodEnd: q.end,
    targetValue: 9,
  }));

  const milestoneSpec: Spec = {
    label: "Lifetime revenue milestone",
    metric: GoalMetric.REVENUE,
    period: GoalPeriod.MILESTONE,
    periodStart: null,
    periodEnd: null,
    targetValue: 150_000,
    notes: MILESTONE_NOTES,
  };

  const now = new Date();
  let created = 0;
  let linked = 0;
  let unchanged = 0;

  // The annual goal lands first so the quarterlies have a parent to point at.
  async function ensure(spec: Spec, parentGoalId: string | null, parentLabel?: string) {
    const existing = await prisma.goal.findFirst({
      where: whereFor(orgId, spec),
      select: { id: true, parentGoalId: true },
    });

    if (existing) {
      // Repair only: a row from a half-finished run that never got parented.
      if (parentGoalId && !existing.parentGoalId) {
        console.log(`  LINK      ${describe(spec, parentLabel)}`);
        if (apply) {
          await prisma.goal.update({
            where: { id: existing.id },
            data: { parentGoalId },
          });
        }
        linked += 1;
      } else {
        console.log(`  unchanged ${describe(spec, parentLabel)}`);
        unchanged += 1;
      }
      return existing.id;
    }

    console.log(`  CREATE    ${describe(spec, parentLabel)}`);
    created += 1;
    if (!apply) return null;

    const row = await prisma.goal.create({
      data: {
        organizationId: orgId,
        scope: GoalScope.COMPANY,
        ownerUserId: null,
        metric: spec.metric,
        manualLabel: null,
        period: spec.period,
        periodStart: spec.periodStart,
        periodEnd: spec.periodEnd,
        targetValue: spec.targetValue,
        parentGoalId,
        status: GoalStatus.ACTIVE,
        createdByUserId: creatorId,
        approvedByUserId: creatorId,
        approvedAt: now,
        escalationPct: spec.escalationPct ?? null,
        notes: spec.notes ?? null,
      },
      select: { id: true },
    });
    return row.id;
  }

  const annualId = await ensure(annualSpec, null);
  for (const spec of quarterlyRevenue) {
    await ensure(spec, annualId, annualSpec.label);
  }
  for (const spec of quarterlySignedClients) {
    await ensure(spec, null);
  }
  await ensure(milestoneSpec, null);

  console.log(
    `\n${apply ? "Wrote" : "Would write"}: ${created} created, ${linked} parent link(s), ` +
      `${unchanged} already correct.`,
  );
  if (!apply) console.log("Nothing was written. Re-run with --apply to write.\n");
  else console.log("Done. Re-running this script is a no-op.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
