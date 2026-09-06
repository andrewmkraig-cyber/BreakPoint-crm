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
import { GoalMeter, shouldSegment } from "@/app/dashboard/goal-meter";
import {
  DEFAULT_GOALS_PERIOD,
  goalsPeriod,
  type GoalsGrain,
  type GoalsPeriodSelection,
} from "@/app/dashboard/goals-period";
import { GoalsAddButton, type AssignableUser, type ParentGoalOption } from "@/app/dashboard/goal-form-modal";
import { GoalsApprovalQueue, type PendingGoalRow } from "@/app/dashboard/goals-approval-queue";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  canApproveCompanyGoal,
  canSetGoalFor,
  loadGoalActor,
} from "@/lib/goals/permissions";
import { GOAL_METRIC_LABELS, GOAL_PERIOD_LABELS, HEADLINE_LIMIT } from "@/lib/goals/goal-options";
import { prisma } from "@/lib/prisma";
import {
  listEarnedPlacements,
  resolveAvgDealSize,
  resolveMetric,
  resolvePlacements,
  resolveRevenue,
  resolveSignedClients,
  utcMarkerDaysInclusive,
  etWindow,
  etDaysInclusive,
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

// The period word the revenue meter shows for the active selector grain
// (the count meters keep GOAL_PERIOD_LABELS[g.period] instead). Distinct
// from GOAL_PERIOD_LABELS, which calls the annual period "Annual" - the
// selector's Year grain reads "Yearly".
const GRAIN_PERIOD_WORD: Record<GoalsGrain, string> = {
  DAY: "Daily",
  WEEK: "Weekly",
  MONTH: "Monthly",
  QUARTER: "Quarterly",
  YEAR: "Yearly",
};

// ET-day length of a [start, end] window of UTC calendar-date markers,
// counted EXACTLY as pacingForCumulative does (resolve the markers to ET
// instants, then count inclusive ET days) so a prorated target and the
// pace maths that consume it never disagree by a day across a DST edge.
function etDayCount(periodStart: Date, periodEnd: Date): number {
  const { start, endExclusive } = etWindow(periodStart, periodEnd);
  const lastInstant = new Date(endExclusive.getTime() - 1);
  return Math.max(1, etDaysInclusive(start, lastInstant));
}

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

  // At Month and above, all three headline cards resolve over the SAME
  // selected window (revenue follows the selector, the count meters follow
  // it from Month up), so "Days remaining" is identical across them and is
  // hoisted to page level. At Day/Week the cards do not share a window
  // (revenue follows the selector, counts floor to Quarter), so it stays
  // per-card and there is no page-level copy.
  const daysRemainingIsShared =
    selection.grain === "MONTH" ||
    selection.grain === "QUARTER" ||
    selection.grain === "YEAR";
  // Day count for the shared page-level readout - the selected window's own
  // pacing. target/actual are irrelevant to the day count; this changes no
  // metric, it only relocates a number that already renders.
  const pageDays = daysRemainingIsShared
    ? pacingForCumulative({
        target: 1,
        actual: 0,
        periodStart: period.rangeStart,
        periodEnd: period.rangeEnd,
      })
    : null;

  // Who is looking at this, and what may they do? Resolved from the SERVER
  // SESSION only (rule 8) - never from the URL or a prop. A viewer with no
  // membership row gets no write affordances at all rather than a fallback.
  const session = await getServerSession(authOptions);
  const sessionEmail = session?.user?.email ?? null;
  const sessionUser = sessionEmail
    ? await prisma.user.findUnique({ where: { email: sessionEmail }, select: { id: true } })
    : null;
  const viewer = sessionUser ? await loadGoalActor(org.id, sessionUser.id) : null;
  const canApprove = viewer ? canApproveCompanyGoal(org.id, viewer.actor) : false;

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
            // EARNED is the pacing actual (Ace 99.0). billed and
            // collected still ride along on `revenue` for display.
            actual: goalRevenue.earned,
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
  //
  // EXPIRED goals are excluded: a goal whose window has already ended has
  // nothing left to pace and would read $0 / "0d left" / BEHIND forever, so
  // a Year selection must not resurrect Q1 and Q2. Compared MARKER against
  // MARKER - `todayMarker` (above) is today's ET calendar date as a UTC
  // marker and `g.periodEnd` is the same marker form, which is how the rest
  // of the goals code counts days. `>=` keeps a goal through its final ET
  // day (periodEnd === today still runs).
  const periodGoals = goals.filter(
    (g) =>
      g.period !== "MILESTONE" &&
      g.periodStart != null &&
      g.periodEnd != null &&
      g.periodStart <= period.rangeEnd &&
      g.periodEnd >= period.rangeStart &&
      g.periodEnd >= todayMarker,
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
        // Revenue rows show the earned actual with collected muted
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

  // Pace chart buckets. Built from the individual placements behind the
  // same earnedPlacementWhere the headline uses, bucketed in JS, so the
  // last bucket's cumulative total always equals the meter's actual.
  // Switched from billed invoices to earned placements in Ace 99.0 when
  // earned became the pacing figure - a curve drawn from a different tier
  // than the headline would never land on the headline's number.
  const paceChart = meterPacing
    ? await (async () => {
        const goal = meterPacing.goal;
        const placements = await listEarnedPlacements(
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
            placements,
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

  // People this viewer may set goals for. The modal only offers these, and
  // createGoal re-checks the same rule server-side regardless of what the
  // client sends.
  const assignableUsers: AssignableUser[] = [];
  if (viewer) {
    const members = Array.from(viewer.directory.members.values()).filter((m) =>
      canSetGoalFor(org.id, viewer.actor, m, viewer.directory),
    );
    const names = members.length
      ? await prisma.user.findMany({
          where: { id: { in: members.map((m) => m.id) } },
          select: { id: true, name: true, email: true },
        })
      : [];
    for (const u of names) {
      assignableUsers.push({ id: u.id, name: u.name ?? u.email ?? u.id });
    }
    assignableUsers.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Longer goals a new one can roll up into. A goal only makes sense as a
  // parent if it outlasts its child, so quarterlies point at annuals.
  const parentOptions: ParentGoalOption[] = goals
    .filter((g) => g.period === "ANNUAL" || g.period === "MILESTONE")
    .map((g) => ({
      id: g.id,
      label: `${GOAL_METRIC_LABELS[g.metric]} · ${GOAL_PERIOD_LABELS[g.period]}${
        g.periodStart ? ` ${g.periodStart.getUTCFullYear()}` : ""
      }`,
    }));

  // Approval queue. Only loaded for someone who can actually act on it.
  const pendingRows: PendingGoalRow[] = [];
  if (canApprove) {
    const pending = await prisma.goal.findMany({
      where: { organizationId: org.id, status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
    });
    const requesterIds = Array.from(new Set(pending.map((g) => g.createdByUserId)));
    const requesters = requesterIds.length
      ? await prisma.user.findMany({
          where: { id: { in: requesterIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const requesterName = new Map(
      requesters.map((u) => [u.id, u.name ?? u.email ?? u.id]),
    );
    for (const g of pending) {
      const money = g.metric === "REVENUE" || g.metric === "AVG_DEAL_SIZE";
      pendingRows.push({
        id: g.id,
        requesterName: requesterName.get(g.createdByUserId) ?? "Unknown",
        scopeLabel: g.scope === "COMPANY" ? "Company" : "Personal",
        metricLabel: g.manualLabel ?? GOAL_METRIC_LABELS[g.metric],
        targetLabel: money
          ? USD.format(Math.round(Number(g.targetValue)))
          : String(Number(g.targetValue)),
        periodLabel:
          g.periodStart && g.periodEnd
            ? `${g.periodStart.toISOString().slice(0, 10)} - ${g.periodEnd.toISOString().slice(0, 10)}`
            : GOAL_PERIOD_LABELS[g.period],
        notes: g.notes,
      });
    }
  }

  const addGoalButton = viewer ? (
    <GoalsAddButton
      assignableUsers={assignableUsers}
      parentOptions={parentOptions}
      canApprove={canApprove}
    />
  ) : null;

  // ---- Headline meter row -----------------------------------------------
  // Goals flagged isHeadline render as full meter cards above the list.
  // Everything else stays a slim bar in the list panel. RATIO goals are
  // excluded outright: an average converges rather than accumulating, so a
  // percent-toward-target would be a meaningless number for one.
  const headlineGoals = goals
    .filter(
      (g) =>
        g.isHeadline &&
        g.period !== "MILESTONE" &&
        g.periodStart != null &&
        g.periodEnd != null &&
        pacingShapeFor(g.metric, g.period) === "CUMULATIVE" &&
        g.periodStart <= period.rangeEnd &&
        g.periodEnd >= period.rangeStart,
    )
    // Same cap the write path enforces, applied again on read so a row can
    // never grow past four even if the data got there some other way.
    .slice(0, HEADLINE_LIMIT);

  const headlineMeters = await Promise.all(
    headlineGoals.map(async (g) => {
      // At DAY and WEEK the window is too short for pace to mean anything -
      // a prorated revenue slice hits absurd percentages (a week's ~$9,511
      // slice read 606% "Complete") and a prorated count target rounds to
      // 1/week or 1/day, so Behind means "no deal today" rather than off
      // pace. So at those grains EVERY meter reports ACTUALS ONLY over the
      // selected window: the count / dollars for that window, no target,
      // percentage, bar or pace. At MONTH and above the full pace treatment
      // renders - revenue prorates its quarterly target and the counts
      // prorate from Month up, rounded to a whole unit so the segmented bar
      // can draw them (9/quarter -> 3 at Month).
      const isRevenue = g.metric === "REVENUE";
      const isDayOrWeek = selection.grain === "DAY" || selection.grain === "WEEK";
      const grainAtOrAboveMonth =
        selection.grain === "MONTH" ||
        selection.grain === "QUARTER" ||
        selection.grain === "YEAR";
      const actualsOnly = isDayOrWeek;
      // Every headline meter resolves over the SELECTED window now, at every
      // grain - the old count floor to the quarter at Day/Week is gone, so a
      // count is the count for the selected window. followsSelector is
      // therefore always true and drives the grain-word + selected-window
      // labels in the render below.
      const followsSelector = isDayOrWeek || isRevenue || grainAtOrAboveMonth;

      const rangeStart = period.rangeStart;
      const rangeEnd = period.rangeEnd;

      const result = await resolveMetric({
        organizationId: org.id,
        metric: g.metric,
        rangeStart,
        rangeEnd,
        ownerUserId: g.ownerUserId,
        period: g.period,
        goalId: g.id,
      });

      const rawTarget = Number(g.targetValue);
      const proratedTarget =
        rawTarget *
        (etDayCount(period.rangeStart, period.rangeEnd) /
          etDayCount(g.periodStart!, g.periodEnd!));
      // Target is rendered only at Month and above (actuals-only cards show
      // none). Revenue keeps the exact prorated figure; the counts round to
      // a whole unit (min 1) so the segmented bar can draw them.
      const target = isRevenue ? proratedTarget : Math.max(1, Math.round(proratedTarget));

      const pacing = pacingForCumulative({
        target,
        actual: result.value ?? 0,
        periodStart: rangeStart,
        periodEnd: rangeEnd,
        // Partial current day is revenue-only and only shifts pace figures,
        // which actuals-only mode does not render - harmless at Day/Week.
        partialCurrentDay: isRevenue,
        revenue: result.revenue,
      });
      return {
        goal: g,
        pacing,
        target,
        measurable: result.value !== null,
        followsSelector,
        actualsOnly,
      };
    }),
  );

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          GOALS &amp; PACE
        </p>
        {addGoalButton}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <GoalsPeriodTabs value={selection} rangeLabel={period.label} />
        {/* Days remaining is shown once here when the headline cards share
            one window (Month and above), instead of repeating identically on
            all three. At Day/Week it stays per-card. */}
        {pageDays && (
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
            Days remaining{" "}
            <span className="tabular-nums text-court-fg">
              {pageDays.daysRemaining} of {pageDays.daysInPeriod}
            </span>
          </p>
        )}
      </div>
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
          <div className="mt-3">{addGoalButton}</div>
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
      {/* The standalone revenue meter that used to sit here is gone (Ace
          99.3): revenue is a headline goal now, so it renders in the row
          below like every other one and would otherwise appear twice.
          `meterPacing` is still resolved above - the pace chart needs the
          quarter's revenue goal to draw its required-pace line. */}
      {/* Only rendered when there is actually something to approve. */}
      {pendingRows.length > 0 && <GoalsApprovalQueue rows={pendingRows} />}
      {/* Headline meters. Three across at xl and two at md, which keeps a
          track wide enough for its segments to stay countable at every
          breakpoint - measured at 34px per segment for a 9-unit goal on a
          three-across desktop row, and 30px on mobile. See SEGMENT_LIMIT. */}
      {headlineMeters.length > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {headlineMeters.map(({ goal: g, pacing, target, measurable, followsSelector, actualsOnly }) => {
            // The title is the metric name (large); periodWord is the grain
            // word (small, muted beside it). Both track the meter's resolved
            // window: the active grain and the selected window when it follows
            // the selector, else the goal's stored QUARTERLY and its quarter
            // label.
            const periodWord = followsSelector
              ? GRAIN_PERIOD_WORD[selection.grain]
              : GOAL_PERIOD_LABELS[g.period];
            const title = g.manualLabel ?? GOAL_METRIC_LABELS[g.metric];
            const window = followsSelector
              ? period.label
              : g.periodStart
                ? quarterOrRangeLabel(g.periodStart, g.period)
                : period.label;
            if (!measurable) return null;
            if (g.metric === "REVENUE") {
              return (
                <GoalsRevenueMeter
                  key={g.id}
                  title={GOAL_METRIC_LABELS[g.metric]}
                  periodWord={periodWord}
                  periodLabel={period.label}
                  pacing={pacing}
                  showDaysRemaining={!daysRemainingIsShared}
                  actualsOnly={actualsOnly}
                />
              );
            }
            return (
              <GoalMeter
                key={g.id}
                title={title}
                periodWord={periodWord}
                periodLabel={window}
                pacing={pacing}
                // Lead with the count achieved (e.g. "8"); percent moves to
                // the supporting line ("89% of 9 · Q3 2026"), matching the
                // revenue meter. Presentation only.
                focus="value"
                showDaysRemaining={!daysRemainingIsShared}
                actualsOnly={actualsOnly}
                format={(n) => String(Math.round(n * 100) / 100)}
                fill={
                  shouldSegment(target)
                    ? { kind: "segments", units: target }
                    : { kind: "single" }
                }
              />
            );
          })}
        </div>
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
              title={`Cumulative earned · ${quarterLabel(meterPacing.goal.periodStart!)}`}
              subtitle="Earned to date against a straight run to target."
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

// A window label for a headline meter: "Q3 2026" for a quarter, the year
// for an annual, otherwise the raw dates. Read in UTC because goal period
// bounds are UTC calendar-date markers.
function quarterOrRangeLabel(periodStart: Date, period: string): string {
  const y = periodStart.getUTCFullYear();
  if (period === "QUARTERLY") return `Q${Math.floor(periodStart.getUTCMonth() / 3) + 1} ${y}`;
  if (period === "ANNUAL") return String(y);
  if (period === "MONTHLY") {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(periodStart);
  }
  return periodStart.toISOString().slice(0, 10);
}

// Splits a goal's period into up to 12 equal buckets and returns the
// cumulative billed total at the end of each, alongside where a straight
// run to target would be at that point.
function buildPaceBuckets(
  periodStart: Date,
  periodEnd: Date,
  events: Array<{ placedAt: Date; amount: number }>,
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
  const sorted = [...events].sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());

  for (let i = 0; i < bucketCount; i += 1) {
    const startDayOffset = Math.round(daysPer * i);
    const endDayOffset = Math.round(daysPer * (i + 1));
    const bucketStartMs = startMs + startDayOffset * 86_400_000;
    const endMs = startMs + endDayOffset * 86_400_000;
    while (cursor < sorted.length && sorted[cursor].placedAt.getTime() < endMs) {
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
