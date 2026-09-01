import { Award, DollarSign, Gauge, Handshake, Target, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { KpiTile } from "@/app/dashboard/kpi-tile";
import { GoalsListPanel, METRIC_LABEL, type GoalListRow } from "@/app/dashboard/goals-list-panel";
import { GoalsMilestoneCard } from "@/app/dashboard/goals-milestone-card";
import { GoalsPaceChart, type PaceBucket } from "@/app/dashboard/goals-pace-chart";
import { GoalsLeaderboardPanel } from "@/app/dashboard/goals-leaderboard-panel";
import type { ClientLeaderboardRowView } from "@/app/dashboard/goals-client-leaderboard";
import { getClientLeaderboard } from "@/lib/goals/client-leaderboard";
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
  listBilledInvoices,
  resolveAvgDealSize,
  resolveMetric,
  resolvePlacements,
  resolveRevenue,
  resolveSignedClients,
  utcMarkerDaysInclusive,
} from "@/lib/goals/metrics";
import {
  pacingForCumulative,
  pacingForMilestone,
  pacingForRatio,
  pacingShapeFor,
  priorEquivalentPeriod,
  MILESTONE_RUN_RATE_DAYS,
} from "@/lib/goals/pacing";

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

  // ---- Goal list rows -------------------------------------------------
  // A goal appears when its own window OVERLAPS the selected one, so a
  // Quarter view shows that quarter's goals AND the annual that contains
  // it, and a Year view shows every quarter inside it. MILESTONE goals have
  // no window at all and are pinned to the bottom regardless of period.
  const periodGoals = goals.filter(
    (g) =>
      g.period !== "MILESTONE" &&
      g.periodStart != null &&
      g.periodEnd != null &&
      g.periodStart <= period.rangeEnd &&
      g.periodEnd >= period.rangeStart,
  );
  const milestoneGoals = goals.filter((g) => g.period === "MILESTONE");

  // Each row resolves over ITS OWN window, not the selected one - that is
  // what a goal row means. Company and user goals sit in one list; a
  // user-scope row carries a small owner label so the list already reads
  // correctly once a second recruiter exists.
  const ownerIds = Array.from(
    new Set(goals.map((g) => g.ownerUserId).filter((id): id is string => Boolean(id))),
  );
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const ownerName = new Map(owners.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const listRows: GoalListRow[] = await Promise.all(
    [...periodGoals, ...milestoneGoals].map(async (g): Promise<GoalListRow> => {
      const target = Number(g.targetValue);
      const isMoney = g.metric === "REVENUE" || g.metric === "AVG_DEAL_SIZE";
      const isMilestone = g.period === "MILESTONE";
      const rangeStart = g.periodStart ?? ALL_TIME_START;
      const rangeEnd = g.periodEnd ?? period.rangeEnd;

      const result = await resolveMetric({
        organizationId: org.id,
        metric: g.metric,
        rangeStart,
        rangeEnd,
        ownerUserId: g.ownerUserId,
        period: g.period,
        goalId: g.id,
      });

      const base = {
        id: g.id,
        metric: g.metric,
        label: g.manualLabel ?? METRIC_LABEL[g.metric],
        isMoney,
        ownerName: g.ownerUserId ? ownerName.get(g.ownerUserId) ?? null : null,
        windowLabel: isMilestone
          ? "All time"
          : `${g.periodStart!.toISOString().slice(0, 10)} - ${g.periodEnd!.toISOString().slice(0, 10)}`,
        target,
        actual: result.value,
        notTrackedReason: result.unsupportedReason,
        isMilestone,
      };

      if (pacingShapeFor(g.metric, g.period) === "RATIO") {
        const prior = g.periodStart && g.periodEnd
          ? priorEquivalentPeriod(g.periodStart, g.periodEnd)
          : null;
        const priorResult = prior
          ? await resolveMetric({
              organizationId: org.id,
              metric: g.metric,
              rangeStart: prior.start,
              rangeEnd: prior.end,
              ownerUserId: g.ownerUserId,
              period: g.period,
              goalId: g.id,
            })
          : null;
        const r = pacingForRatio({
          target,
          actual: result.value,
          priorActual: priorResult?.value ?? null,
        });
        return {
          ...base,
          shape: "RATIO",
          status: r.status,
          percentDifference: r.percentDifference,
          priorActual: r.priorActual,
          trend: r.trend,
        };
      }

      if (isMilestone) {
        // A milestone has no period to pace against, so it carries no
        // status chip status and no days-remaining - just progress.
        const pct = target > 0 && result.value !== null ? (result.value / target) * 100 : 0;
        return {
          ...base,
          shape: "CUMULATIVE",
          status: null,
          progressPct: pct,
          daysRemaining: null,
          collected: null,
        };
      }

      const p = pacingForCumulative({
        target,
        actual: result.value ?? 0,
        periodStart: g.periodStart!,
        periodEnd: g.periodEnd!,
        revenue: result.revenue,
      });
      return {
        ...base,
        shape: "CUMULATIVE",
        status: result.value === null ? null : p.status,
        progressPct: target > 0 && result.value !== null ? (result.value / target) * 100 : 0,
        daysRemaining: p.daysRemaining,
        // Revenue rows show billed as the actual with collected muted
        // underneath. Every other metric has no second figure.
        collected: g.metric === "REVENUE" ? (result.revenue?.collected ?? null) : null,
      };
    }),
  );

  // ---- Milestone card + pace chart -------------------------------------
  const milestoneGoal = milestoneGoals[0] ?? null;
  const milestoneCard = milestoneGoal
    ? await (async () => {
        const [lifetime, trailing] = await Promise.all([
          resolveMetric({
            organizationId: org.id,
            metric: milestoneGoal.metric,
            rangeStart: ALL_TIME_START,
            rangeEnd: period.rangeEnd,
            ownerUserId: milestoneGoal.ownerUserId,
            period: milestoneGoal.period,
            goalId: milestoneGoal.id,
          }),
          resolveMetric({
            organizationId: org.id,
            metric: milestoneGoal.metric,
            rangeStart: new Date(Date.now() - MILESTONE_RUN_RATE_DAYS * 86_400_000),
            rangeEnd: period.rangeEnd,
            ownerUserId: milestoneGoal.ownerUserId,
            period: milestoneGoal.period,
            goalId: milestoneGoal.id,
          }),
        ]);
        return {
          label: milestoneGoal.manualLabel ?? `${METRIC_LABEL[milestoneGoal.metric]} milestone`,
          note: milestoneGoal.notes,
          pacing: pacingForMilestone({
            target: Number(milestoneGoal.targetValue),
            actual: lifetime.value ?? 0,
            trailingWindowActual: trailing.value ?? 0,
          }),
        };
      })()
    : null;

  // Pace chart buckets. Built from the individual billed invoices behind
  // the same billedInvoiceWhere the headline uses, bucketed in JS, so the
  // last bucket's cumulative total always equals the meter's billed figure.
  const paceChart = meterPacing
    ? await (async () => {
        const goal = meterPacing.goal;
        const invoices = await listBilledInvoices(
          org.id,
          goal.periodStart!,
          goal.periodEnd!,
          null,
        );
        return {
          target: Number(goal.targetValue),
          buckets: buildPaceBuckets(
            goal.periodStart!,
            goal.periodEnd!,
            invoices,
            Number(goal.targetValue),
          ),
        };
      })()
    : null;

  // ---- Client leaderboard ----------------------------------------------
  // Both scopes resolved up front so the toggle is instant.
  const [periodLeaderboard, allTimeLeaderboard] = await Promise.all([
    getClientLeaderboard({
      organizationId: org.id,
      rangeStart: period.rangeStart,
      rangeEnd: period.rangeEnd,
    }),
    getClientLeaderboard({
      organizationId: org.id,
      rangeStart: period.rangeStart,
      rangeEnd: period.rangeEnd,
      allTime: true,
    }),
  ]);
  const toView = (r: Awaited<ReturnType<typeof getClientLeaderboard>>[number]): ClientLeaderboardRowView => ({
    clientId: r.clientId,
    slug: r.slug,
    name: r.name,
    revenueCollected: r.revenueCollected,
    revenueBilled: r.revenueBilled,
    revenueEarned: r.revenueEarned,
    placements: r.placements,
    jobOrdersOpened: r.jobOrdersOpened,
    activeJobs: r.activeJobs,
    avgDealSize: r.avgDealSize,
    feePct: r.feePct,
    // Dates cannot cross into a client component as Date objects.
    lastPlacementIso: r.lastPlacementAt?.toISOString() ?? null,
  });

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
      <GoalsListPanel rows={listRows} />
      {/* Milestone tracker and pace chart share one row. */}
      {(milestoneCard || paceChart) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {milestoneCard && (
            <GoalsMilestoneCard
              label={milestoneCard.label}
              note={milestoneCard.note}
              pacing={milestoneCard.pacing}
            />
          )}
          {paceChart && meterPacing && (
            <GoalsPaceChart
              title={`Cumulative billed · ${quarterLabel(meterPacing.goal.periodStart!)}`}
              subtitle="Billed to date against a straight run to target."
              buckets={paceChart.buckets}
              target={paceChart.target}
            />
          )}
        </div>
      )}
      <GoalsLeaderboardPanel
        periodRows={periodLeaderboard.map(toView)}
        allTimeRows={allTimeLeaderboard.map(toView)}
        periodLabel={period.label}
      />
    </div>
  );
}

// Everything Ace has recorded postdates this; used as the open end of an
// all-time window.
const ALL_TIME_START = new Date(Date.UTC(2000, 0, 1));

// Splits a goal's period into up to 12 equal buckets and returns the
// cumulative billed total at the end of each, alongside where a straight
// run to target would be at that point.
function buildPaceBuckets(
  periodStart: Date,
  periodEnd: Date,
  invoices: Array<{ sentAt: Date; amount: number }>,
  target: number,
): PaceBucket[] {
  const totalDays = Math.max(1, utcMarkerDaysInclusive(periodStart, periodEnd));
  const bucketCount = Math.min(12, totalDays);
  const daysPer = totalDays / bucketCount;
  const now = Date.now();

  const startMs = Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth(),
    periodStart.getUTCDate(),
  );

  const buckets: PaceBucket[] = [];
  let cumulative = 0;
  let cursor = 0;
  const sorted = [...invoices].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  for (let i = 0; i < bucketCount; i += 1) {
    const startDayOffset = Math.round(daysPer * i);
    const endDayOffset = Math.round(daysPer * (i + 1));
    const bucketStartMs = startMs + startDayOffset * 86_400_000;
    const endMs = startMs + endDayOffset * 86_400_000;
    while (cursor < sorted.length && sorted[cursor].sentAt.getTime() < endMs) {
      cumulative += sorted[cursor].amount;
      cursor += 1;
    }
    buckets.push({
      label: monthDayLabel(new Date(endMs - 86_400_000)),
      cumulativeActual: cumulative,
      // A straight line from 0 to target across the period.
      requiredPace: target * ((i + 1) / bucketCount),
      // Future means NOT YET STARTED. The bucket containing today is
      // in progress, not future: marking it future hid the most recent
      // billing and left the curve stopping short of the headline figure.
      isFuture: bucketStartMs > now,
    });
  }
  return buckets;
}

const BUCKET_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
});

function monthDayLabel(d: Date): string {
  return BUCKET_LABEL.format(d);
}

// "Q3 2026" from the goal's own period start, read in UTC because goal
// period bounds are UTC calendar-date markers (see metrics.ts).
function quarterLabel(periodStart: Date): string {
  const q = Math.floor(periodStart.getUTCMonth() / 3) + 1;
  return `Q${q} ${periodStart.getUTCFullYear()}`;
}
