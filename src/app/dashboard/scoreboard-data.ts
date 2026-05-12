import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getRfClientsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { normalizeClient, normalizeJob } from "@/lib/rf-payload-shapes";

// Stages observed on Placement.stage today: offer | pending_start | hired.
// Anything earlier than "offer" lives outside this table — submitted /
// interview activity is reconstructed from ActionLog + Interview rows.
const IN_PIPELINE_STAGES = ["offer", "pending_start"] as const;

const DAYS = 24 * 60 * 60 * 1000;

// Q2 2026 is the same window MyDashboard pins to. When we get a period
// picker we'll derive this from a search param.
const Q2_START = new Date("2026-04-01T00:00:00.000Z");
const Q2_END_EXCLUSIVE = new Date("2026-07-01T00:00:00.000Z");

export type ScoreboardData = {
  period: { label: string; start: Date; endExclusive: Date };
  kpis: {
    pipelineValueUsd: number | null;
    avgFeeSizeUsd: number | null;
    placementsQtd: number;
    winRatePct: number | null;
    winRateNumerator: number;
    winRateDenominator: number;
    medianDaysToFill: number | null;
  };
  funnel: {
    submitted: number;
    interview: number;
    offer: number;
    placed: number;
  };
  cashForecast: {
    pendingStartUsd: number;
    pendingStartCount: number;
  };
  topClients: Array<{ id: string; name: string; placements: number; feeUsd: number }>;
  topRoles: Array<{ title: string; placements: number; avgFeeUsd: number | null }>;
  momentum: Array<{
    id: string;
    candidateName: string;
    clientName: string;
    eventLabel: string;
    eventAt: Date;
    kind: "win" | "up" | "down";
  }>;
};

export async function getScoreboardData(): Promise<ScoreboardData> {
  const org = await getCurrentOrg();
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAYS);

  const [
    pipelinePlacementsRaw,
    placedLast90,
    placementsQtdCount,
    submitsLast90,
    interviewsLast90,
    offersLast90,
    placedAggLast90,
    pendingStartAgg,
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
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        placedAt: { gte: ninetyDaysAgo, lte: now },
      },
      select: { feeTotal: true, createdAt: true, placedAt: true },
    }),
    // Quarter-to-date placement count (placedAt landing in Q2 2026).
    prisma.placement.count({
      where: {
        organizationId: org.id,
        placedAt: { gte: Q2_START, lt: Q2_END_EXCLUSIVE },
      },
    }),
    // Funnel left edge: submit actions in last 90d. Each row is a single
    // candidate-to-job submittal.
    prisma.actionLog.count({
      where: {
        organizationId: org.id,
        actionType: "submit",
        createdAt: { gte: ninetyDaysAgo, lte: now },
      },
    }),
    prisma.interview.count({
      where: {
        organizationId: org.id,
        createdAt: { gte: ninetyDaysAgo, lte: now },
      },
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

  const winRateDenominator = submitsLast90;
  const winRateNumerator = placedAggLast90._count._all;
  const winRatePct = winRateDenominator > 0
    ? Math.round((winRateNumerator / winRateDenominator) * 100)
    : null;

  const daysToFill = placedLast90
    .map((p) =>
      p.placedAt && p.createdAt
        ? Math.round((p.placedAt.getTime() - p.createdAt.getTime()) / DAYS)
        : null,
    )
    .filter((v): v is number => typeof v === "number" && v >= 0)
    .sort((a, b) => a - b);
  const medianDaysToFill = daysToFill.length > 0
    ? daysToFill[Math.floor(daysToFill.length / 2)]
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

  const clientAgg = new Map<string, { name: string; placements: number; feeUsd: number }>();
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
      const prev = clientAgg.get(clientKey) ?? { name: clientName, placements: 0, feeUsd: 0 };
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
    .map((c, i) => ({ id: `c${i}`, name: c.name, placements: c.placements, feeUsd: c.feeUsd }));

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
    period: { label: "This Quarter", start: Q2_START, endExclusive: Q2_END_EXCLUSIVE },
    kpis: {
      pipelineValueUsd: pipelineValueUsd > 0 ? pipelineValueUsd : null,
      avgFeeSizeUsd,
      placementsQtd: placementsQtdCount,
      winRatePct,
      winRateNumerator,
      winRateDenominator,
      medianDaysToFill,
    },
    funnel: {
      submitted: submitsLast90,
      interview: interviewsLast90,
      offer: offersLast90,
      placed: placedAggLast90._count._all,
    },
    cashForecast: {
      pendingStartUsd: pendingStartAgg._sum.feeTotal ?? 0,
      pendingStartCount: pendingStartAgg._count._all,
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
