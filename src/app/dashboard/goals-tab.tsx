import { Award, DollarSign, Gauge, Handshake, Target, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { KpiTile } from "@/app/dashboard/kpi-tile";
import { GoalsPeriodTabs } from "@/app/dashboard/goals-period-tabs";
import { GoalsRevenueMeter } from "@/app/dashboard/goals-revenue-meter";
import {
  DEFAULT_GOALS_PERIOD,
  goalsPeriod,
  type GoalsPeriodSelection,
} from "@/app/dashboard/goals-period";
import { Button } from "@/components/ui/button";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  resolveAvgDealSize,
  resolvePlacements,
  resolveRevenue,
  resolveSignedClients,
} from "@/lib/goals/metrics";
import { pacingForCumulative } from "@/lib/goals/pacing";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Every metric that returns null renders this, never a zero. "0" is a
// measured result; a dash plus this caption is the honest rendering of
// "Ace does not track this yet".
const NOT_TRACKED = "not tracked yet";

// Server component. Reads exclusively through the Prompt 2 goals engine,
// org-scoped via getCurrentOrg (architecture rule 8) - the org id is never
// taken from the URL or any client input.
export async function GoalsTab({
  selection = DEFAULT_GOALS_PERIOD,
}: {
  selection?: GoalsPeriodSelection;
} = {}) {
  const org = await getCurrentOrg();
  const period = goalsPeriod(selection);
  const { rangeStart, rangeEnd } = period;

  const [goals, revenue, placements, signedClients, avgDealSize] = await Promise.all([
    prisma.goal.findMany({
      where: { organizationId: org.id, status: "ACTIVE" },
      orderBy: [{ period: "asc" }, { periodStart: "asc" }, { metric: "asc" }],
    }),
    resolveRevenue(org.id, rangeStart, rangeEnd, null),
    resolvePlacements(org.id, rangeStart, rangeEnd, null),
    resolveSignedClients(org.id, rangeStart, rangeEnd, null),
    resolveAvgDealSize(org.id, rangeStart, rangeEnd, null),
  ]);

  // The meter's default scope is the CURRENT QUARTER against its own
  // quarterly revenue goal, independent of the period tabs above - the
  // quarter is the number the desk is actually held to. It is matched by
  // period + metric, and only when the selected window sits inside it, so
  // the meter never claims to describe a window it isn't measuring.
  //
  // Matched MARKER against MARKER. Goal period bounds are UTC
  // calendar-date markers, and `period.start` is a resolved instant that
  // can sit hours either side of its own calendar date depending on the
  // server clock - comparing the two directly put Q3 inside the Q2 goal on
  // a non-UTC server.
  //
  // The meter follows the selector only when the SELECTED WINDOW FITS
  // INSIDE one quarter (Day, Week, Month, Quarter). A window that spans
  // quarters - Year, most obviously - has no single quarter goal to
  // describe, and anchoring it to whichever goal contained the window's
  // first day made the Year view show Q1's $0 next to YTD numbers. In that
  // case it falls back to the quarter containing TODAY, which is the
  // number the desk is actually being held to right now.
  const quarterRevenueGoals = goals.filter(
    (g) =>
      g.metric === "REVENUE" &&
      g.period === "QUARTERLY" &&
      g.periodStart != null &&
      g.periodEnd != null,
  );
  const todayMarker = goalsPeriod({ grain: "DAY", offset: 0 }).rangeStart;
  const quarterGoal =
    quarterRevenueGoals.find(
      (g) =>
        period.rangeStart >= g.periodStart! &&
        period.rangeEnd <= g.periodEnd!,
    ) ??
    quarterRevenueGoals.find(
      (g) => todayMarker >= g.periodStart! && todayMarker <= g.periodEnd!,
    );

  const meterPacing = quarterGoal?.periodStart && quarterGoal.periodEnd
    ? await (async () => {
        const goalRevenue = await resolveRevenue(
          org.id,
          quarterGoal.periodStart!,
          quarterGoal.periodEnd!,
          null,
        );
        return {
          goal: quarterGoal,
          pacing: pacingForCumulative({
            target: Number(quarterGoal.targetValue),
            actual: goalRevenue.billed,
            periodStart: quarterGoal.periodStart!,
            periodEnd: quarterGoal.periodEnd!,
            revenue: goalRevenue,
          }),
        };
      })()
    : null;

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          GOALS &amp; PACE
        </p>
      </div>
      <GoalsPeriodTabs value={selection} rangeLabel={period.label} />
    </div>
  );

  if (goals.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
          <p className="text-[13px] text-court-fg-muted">
            No active goals yet. Set one and this tab starts tracking it against
            real placements, invoices and signed agreements.
          </p>
          <div className="mt-3">
            <Button variant="primary" disabled>
              Add Goal
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const paceTile = meterPacing?.pacing;
  const paceValue =
    paceTile?.status === "AHEAD"
      ? "Ahead"
      : paceTile?.status === "ON_PACE"
        ? "On pace"
        : paceTile?.status === "BEHIND"
          ? "Behind"
          : "Unknown";

  const tiles: Array<{
    label: string;
    value: string;
    sub?: string;
    icon: LucideIcon;
  }> = [
    {
      label: "Revenue Billed",
      value: USD.format(Math.round(revenue.billed)),
      sub: period.label,
      icon: DollarSign,
    },
    {
      label: "Revenue Collected",
      value: USD.format(Math.round(revenue.collected)),
      sub: period.label,
      icon: Wallet,
    },
    {
      label: "Placements",
      value: String(placements),
      sub: period.label,
      icon: Award,
    },
    {
      label: "Signed Clients",
      value: String(signedClients),
      sub: period.label,
      icon: Handshake,
    },
    {
      label: "Avg Deal Size",
      // null here means no placements in the window, which is NOT $0.
      value: avgDealSize === null ? "—" : USD.format(Math.round(avgDealSize)),
      sub: avgDealSize === null ? NOT_TRACKED : "Billed per placement",
      icon: Target,
    },
    {
      label: "Pace",
      value: paceValue,
      sub:
        paceTile?.paceIndex != null
          ? `${paceTile.paceIndex.toFixed(2)}× expected to date`
          : NOT_TRACKED,
      icon: Gauge,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <KpiTile
            key={t.label}
            label={t.label}
            value={t.value}
            sub={t.sub}
            icon={t.icon}
          />
        ))}
      </div>
      {meterPacing && (
        <GoalsRevenueMeter
          goalLabel="Quarterly revenue goal"
          periodLabel={quarterLabel(meterPacing.goal.periodStart!)}
          pacing={meterPacing.pacing}
        />
      )}
    </div>
  );
}

// "Q3 2026" from the goal's own period start, read in UTC because goal
// period bounds are UTC calendar-date markers (see metrics.ts).
function quarterLabel(periodStart: Date): string {
  const q = Math.floor(periodStart.getUTCMonth() / 3) + 1;
  return `Q${q} ${periodStart.getUTCFullYear()}`;
}
