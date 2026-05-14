import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getRfClientsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getInvoiceSummary } from "@/lib/invoices";
import { normalizeClient, normalizeJob } from "@/lib/rf-payload-shapes";
import {
  dashboardPeriodRange,
  type DashboardPeriod,
} from "@/app/dashboard/period-tabs";

// Stages observed on Placement.stage today: offer | pending_start | hired.
// Anything earlier than "offer" lives outside this table — submitted /
// interview activity is reconstructed from ActionLog + Interview rows.
const IN_PIPELINE_STAGES = ["offer", "pending_start"] as const;

const DAYS = 24 * 60 * 60 * 1000;

export type ScoreboardData = {
  period: { label: string; start: Date; endExclusive: Date };
  kpis: {
    pipelineValueUsd: number | null;
    // Count of placements in offer + pending_start, regardless of whether
    // their feeTotal is set. Lets the tile distinguish "no deals" from
    // "deals exist but fees aren't logged" so a missing fee doesn't
    // silently hide an open offer from the dashboard.
    pipelineCount: number;
    avgFeeSizeUsd: number | null;
    placementsQtd: number;
    winRatePct: number | null;
    winRateNumerator: number;
    winRateDenominator: number;
    avgDaysToFill: number | null;
  };
  funnel: {
    submitted: number;
    interview: number;
    offer: number;
    placed: number;
    // Unique-candidate counts powering the Interview Coverage stat: how
    // many distinct candidates were submitted in the window, and of those
    // how many had at least one Interview row. The "submitted" / "interview"
    // fields above keep counting raw events (multiple interviews per
    // candidate inflate the interview count), so a separate coverage
    // metric is the only honest way to read the funnel.
    submittedUniqueCandidates: number;
    interviewedUniqueCandidates: number;
    interviewCoveragePct: number | null;
  };
  cashForecast: {
    pendingStartUsd: number;
    pendingStartCount: number;
    billedUsd: number;
    collectedUsd: number;
  };
  topClients: Array<{
    id: string;
    // Ace cuid the drill-down popup keys on. Empty string for legacy
    // RF-only aggregates (no Ace client row yet) — the popup hides the
    // click affordance in that case.
    clientId: string;
    name: string;
    placements: number;
    feeUsd: number;
  }>;
  topRoles: Array<{
    title: string;
    placements: number;
    avgFeeUsd: number | null;
  }>;
  momentum: Array<{
    id: string;
    candidateName: string;
    clientName: string;
    eventLabel: string;
    eventAt: Date;
    kind: "win" | "up" | "down";
  }>;
};

export async function getScoreboardData(
  period: DashboardPeriod = "THIS_QUARTER",
): Promise<ScoreboardData> {
  const org = await getCurrentOrg();
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAYS);
  const range = dashboardPeriodRange(period, now);
  const periodStart = range.start;
  const periodEnd = range.endExclusive;

  const [
    pipelinePlacementsRaw,
    placedLast90,
    placementsQtdCount,
    submitsLast90Rows,
    interviewsLast90Rows,
    offersLast90,
    placedAggLast90,
    pendingStartAgg,
    q2BilledAgg,
    invoiceSummary,
    rfClients,
    rfJobs,
    aceCandidates,
    momentumRowsRaw,
  ] = await Promise.all([
    // Pipeline value — every active deal (offer + pending_start) carries
    // a feeTotal once the recruiter has logged it. Show the honest sum;
    // we don't track a separate stage-probability weighting yet.
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { in: [...IN_PIPELINE_STAGES] },
      },
      select: { id: true, feeTotal: true, stage: true },
    }),
    // Placed in the last 90 days — for Avg Fee Size and Days to Fill.
    // job.createdAtRf is the original RF posting date for backfilled rows;
    // job.createdAt falls back to when the Job row was created in Ace.
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        placedAt: { gte: ninetyDaysAgo, lte: now },
      },
      select: {
        feeTotal: true,
        placedAt: true,
        job: { select: { createdAt: true, createdAtRf: true } },
      },
    }),
    // Quarter-to-date placement count (placedAt landing in Q2 2026).
    prisma.placement.count({
      where: {
        organizationId: org.id,
        placedAt: { gte: periodStart, lt: periodEnd },
      },
    }),
    // Funnel left edge: submit actions in last 90d. Each row is a single
    // candidate-to-job submittal. We pull subjectId (= candidate cuid or
    // String(rfId)) so we can also derive distinct-candidate count.
    prisma.actionLog.findMany({
      where: {
        organizationId: org.id,
        actionType: "submit",
        createdAt: { gte: ninetyDaysAgo, lte: now },
      },
      select: { subjectId: true },
    }),
    prisma.interview.findMany({
      where: {
        organizationId: org.id,
        createdAt: { gte: ninetyDaysAgo, lte: now },
      },
      select: { candidateId: true, candidateRfId: true },
    }),
    prisma.placement.count({
      where: {
        organizationId: org.id,
        offerReceivedAt: { gte: ninetyDaysAgo, lte: now },
      },
    }),
    prisma.placement.aggregate({
      _count: { _all: true },
      where: {
        organizationId: org.id,
        placedAt: { gte: ninetyDaysAgo, lte: now },
      },
    }),
    // Pending Start cash forecast — fees on placements where the start
    // is locked and we're waiting for day-1. Same shape MyDashboard uses
    // for Q2 billed revenue but scoped by stage instead of date.
    prisma.placement.aggregate({
      _sum: { feeTotal: true },
      _count: { _all: true },
      where: {
        organizationId: org.id,
        stage: "pending_start",
      },
    }),
    // Mirror the Clubhouse Billing Tower so Scoreboard Billed/Collected
    // read the same numbers (see src/app/dashboard/my-dashboard.tsx).
    prisma.placement.aggregate({
      _sum: { feeTotal: true },
      where: {
        organizationId: org.id,
        stage: { in: ["pending_start", "hired"] },
        expectedStartDate: { gte: periodStart, lt: periodEnd },
      },
    }),
    getInvoiceSummary(org.id),
    // Pull RF client + job context so we can name Top Clients/Roles even
    // for RF-rooted placements. The MyDashboard tab already pays for the
    // same fetches; future opportunity is to share via a request cache.
    getRfClientsForOrg().catch(() => []),
    getRfJobsForOrg().catch(() => []),
    // Ace-native client + job names — pulled via the relations on the
    // momentum-row query below; this one is just for top-clients/top-roles.
    prisma.placement.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        feeTotal: true,
        placedAt: true,
        clientId: true,
        clientRfId: true,
        jobId: true,
        jobRfId: true,
        client: { select: { id: true, name: true } },
        job: { select: { id: true, title: true } },
      },
    }),
    // Momentum: any placement that has moved in the last 30 days. We
    // surface the most recent of placedAt / offerReceivedAt as the event.
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { placedAt: { gte: new Date(now.getTime() - 30 * DAYS) } },
          { offerReceivedAt: { gte: new Date(now.getTime() - 30 * DAYS) } },
        ],
      },
      select: {
        id: true,
        stage: true,
        placedAt: true,
        offerReceivedAt: true,
        feeTotal: true,
        candidateId: true,
        candidateRfId: true,
        clientId: true,
        clientRfId: true,
        candidate: { select: { firstName: true, lastName: true } },
        client: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  // --- KPI assembly ---
  const pipelineValueUsd = pipelinePlacementsRaw.reduce(
    (sum, p) => sum + (p.feeTotal ?? 0),
    0,
  );
  const placedFees = placedLast90
    .map((p) => p.feeTotal)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgFeeSizeUsd = placedFees.length > 0
    ? Math.round(placedFees.reduce((a, b) => a + b, 0) / placedFees.length)
    : null;

  // Funnel: raw event counts for the bar chart, plus unique-candidate
  // aggregates for the Interview Coverage tile. Submit subjectId and
  // Interview candidate identifiers are both already in the same form
  // (cuid for Ace-native rows, stringified rfId for RF-rooted rows),
  // so a flat Set comparison is sufficient.
  const submittedCount = submitsLast90Rows.length;
  const interviewCount = interviewsLast90Rows.length;
  const submittedCandidateIds = new Set(
    submitsLast90Rows.map((r) => r.subjectId).filter((s): s is string => !!s),
  );
  const interviewedCandidateIds = new Set<string>();
  for (const iv of interviewsLast90Rows) {
    if (iv.candidateId) interviewedCandidateIds.add(iv.candidateId);
    else if (iv.candidateRfId != null) interviewedCandidateIds.add(String(iv.candidateRfId));
  }
  let interviewedAmongSubmitted = 0;
  submittedCandidateIds.forEach((id) => {
    if (interviewedCandidateIds.has(id)) interviewedAmongSubmitted += 1;
  });
  const interviewCoveragePct = submittedCandidateIds.size > 0
    ? Math.round((interviewedAmongSubmitted / submittedCandidateIds.size) * 100)
    : null;

  const winRateDenominator = submittedCount;
  const winRateNumerator = placedAggLast90._count._all;
  const winRatePct = winRateDenominator > 0
    ? Math.round((winRateNumerator / winRateDenominator) * 100)
    : null;

  const daysToFill = placedLast90
    .map((p) => {
      const jobPostedAt = p.job?.createdAtRf ?? p.job?.createdAt ?? null;
      if (!p.placedAt || !jobPostedAt) return null;
      return Math.round((p.placedAt.getTime() - jobPostedAt.getTime()) / DAYS);
    })
    .filter((v): v is number => typeof v === "number" && v >= 0);
  const avgDaysToFill = daysToFill.length > 0
    ? Math.round(daysToFill.reduce((a, b) => a + b, 0) / daysToFill.length)
    : null;

  // --- Top clients / roles ---
  const rfClientName = new Map<number, string>();
  for (const cl of rfClients) {
    rfClientName.set(cl.id, normalizeClient(cl).name);
  }
  const rfJobTitle = new Map<number, string>();
  for (const j of rfJobs) {
    rfJobTitle.set(j.id, normalizeJob(j).title);
  }

  const clientAgg = new Map<
    string,
    { clientId: string; name: string; placements: number; feeUsd: number }
  >();
  const roleAgg = new Map<string, { title: string; placements: number; feeSum: number; feeCount: number }>();

  for (const p of aceCandidates) {
    const isPlaced = !!p.placedAt;
    if (!isPlaced) continue;

    const clientKey = p.client?.id
      ? `c:${p.client.id}`
      : p.clientRfId != null
        ? `r:${p.clientRfId}`
        : null;
    const clientName = p.client?.name
      ?? (p.clientRfId != null ? rfClientName.get(p.clientRfId) : null);

    if (clientKey && clientName) {
      const prev =
        clientAgg.get(clientKey) ??
        {
          clientId: p.client?.id ?? "",
          name: clientName,
          placements: 0,
          feeUsd: 0,
        };
      prev.placements += 1;
      prev.feeUsd += p.feeTotal ?? 0;
      clientAgg.set(clientKey, prev);
    }

    const roleTitle = p.job?.title
      ?? (p.jobRfId != null ? rfJobTitle.get(p.jobRfId) : null);
    if (roleTitle) {
      const prev = roleAgg.get(roleTitle) ?? { title: roleTitle, placements: 0, feeSum: 0, feeCount: 0 };
      prev.placements += 1;
      if (typeof p.feeTotal === "number" && p.feeTotal > 0) {
        prev.feeSum += p.feeTotal;
        prev.feeCount += 1;
      }
      roleAgg.set(roleTitle, prev);
    }
  }

  const topClients = Array.from(clientAgg.values())
    .sort((a, b) => b.feeUsd - a.feeUsd || b.placements - a.placements)
    .slice(0, 5)
    .map((c, i) => ({
      id: `c${i}`,
      clientId: c.clientId,
      name: c.name,
      placements: c.placements,
      feeUsd: c.feeUsd,
    }));

  const topRoles = Array.from(roleAgg.values())
    .sort((a, b) => b.placements - a.placements || b.feeSum - a.feeSum)
    .slice(0, 5)
    .map((r) => ({
      title: r.title,
      placements: r.placements,
      avgFeeUsd: r.feeCount > 0 ? Math.round(r.feeSum / r.feeCount) : null,
    }));

  // --- Momentum events ---
  const aceCandidateIds = Array.from(
    new Set(
      momentumRowsRaw
        .filter((p) => p.candidateRfId == null && p.candidateId)
        .map((p) => p.candidateId as string),
    ),
  );
  // We already joined candidate via include; nothing else to fetch.
  void aceCandidateIds;

  const momentum = momentumRowsRaw
    .map((p) => {
      const eventAt = p.placedAt ?? p.offerReceivedAt;
      if (!eventAt) return null;
      const candidateName = p.candidate
        ? [p.candidate.firstName, p.candidate.lastName].filter(Boolean).join(" ") || "(unnamed)"
        : p.candidateRfId != null
          ? `RF #${p.candidateRfId}`
          : "(unknown)";
      const clientName = p.client?.name
        ?? (p.clientRfId != null ? rfClientName.get(p.clientRfId) ?? "" : "");
      const placed = p.placedAt;
      const kind: "win" | "up" = placed ? "win" : "up";
      const eventLabel = placed
        ? p.feeTotal && p.feeTotal > 0
          ? `Placed · ${formatMoneyShort(p.feeTotal)} fee`
          : "Placed"
        : "Offer extended";
      return {
        id: p.id,
        candidateName,
        clientName,
        eventLabel,
        eventAt,
        kind,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime())
    .slice(0, 6);

  return {
    period: { label: range.label, start: periodStart, endExclusive: periodEnd },
    kpis: {
      pipelineValueUsd: pipelineValueUsd > 0 ? pipelineValueUsd : null,
      pipelineCount: pipelinePlacementsRaw.length,
      avgFeeSizeUsd,
      placementsQtd: placementsQtdCount,
      winRatePct,
      winRateNumerator,
      winRateDenominator,
      avgDaysToFill,
    },
    funnel: {
      submitted: submittedCount,
      interview: interviewCount,
      offer: offersLast90,
      placed: placedAggLast90._count._all,
      submittedUniqueCandidates: submittedCandidateIds.size,
      interviewedUniqueCandidates: interviewedAmongSubmitted,
      interviewCoveragePct,
    },
    cashForecast: {
      pendingStartUsd: pendingStartAgg._sum.feeTotal ?? 0,
      pendingStartCount: pendingStartAgg._count._all,
      billedUsd: q2BilledAgg._sum.feeTotal ?? 0,
      collectedUsd: invoiceSummary.collectedThisQuarterCents / 100,
    },
    topClients,
    topRoles,
    momentum,
  };
}

// $48,300 → "$48.3K". Sub-$1K renders as exact dollars so a $465 fee
// doesn't disappear into "$0.5K". Sub-$0 (negative) shouldn't happen
// but we render with a sign just in case.
export function formatMoneyShort(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  const sign = usd < 0 ? "-" : "";
  const abs = Math.abs(usd);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}$${k >= 100 ? Math.round(k) : k.toFixed(1)}K`;
  }
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

export function formatPeriodRange(start: Date, endExclusive: Date): string {
  const end = new Date(endExclusive.getTime() - DAYS);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}
