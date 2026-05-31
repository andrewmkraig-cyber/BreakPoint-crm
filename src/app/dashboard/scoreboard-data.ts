import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getRfClientsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { normalizeClient, normalizeJob } from "@/lib/rf-payload-shapes";
import {
  BILLING_EVENT_PLACEMENT_SELECT,
  expandPlacementBillingEvents,
  placementTotalDollars,
  sumEventsCents,
  type PlacementForBilling,
} from "@/lib/billing-events";

// Stages observed on Placement.stage today: offer | pending_start | hired.
// Anything earlier than "offer" lives outside this table — submitted /
// interview activity is reconstructed from ActionLog + Interview rows.
const IN_PIPELINE_STAGES = ["offer", "pending_start"] as const;

// Cancelled placements keep their placedAt / offerReceivedAt timestamps —
// cancelPlacement only flips stage to "cancelled", it never clears the
// dates. So every placedAt/offerReceivedAt-keyed metric must explicitly
// exclude cancelled or a dead deal keeps counting toward revenue, roles
// closed, placement counts, win rate, avg fee, and days-to-fill. Recent
// deal moves is the one exception: it KEEPS cancelled rows so it can
// render a "Placement cancelled" entry instead of a stale "Placed" one.
const NOT_CANCELLED = { not: "cancelled" } as const;

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
    // Pending Invoices — every unsent billing obligation: DRAFT
    // invoices (isFuture=false) PLUS scheduled custom-term events that
    // have no Invoice row yet. Status filter only, no period filter —
    // the recruiter's "still to send" inbox is the full unsent
    // backlog, not just this quarter's. Ethan pre-Confirm-Start: both
    // installments are "scheduled" events with no invoice rows, so
    // this bucket reads $7.5K. After inst1 is Sent, only inst2 is
    // left scheduled → $3.75K.
    pendingInvoicesUsd: number;
    pendingInvoicesCount: number;
    // Billed — SENT invoice events with dueDate in the selected
    // period. PAID is intentionally OUT: an invoice that's been paid
    // belongs to Collected, not Billed. The same $3.75K can never
    // simultaneously appear in both columns.
    billedUsd: number;
    // Collected — PAID invoice events bucketed by paidAt in the
    // selected period.
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
  range: { label: string; start: Date; endExclusive: Date },
): Promise<ScoreboardData> {
  const org = await getCurrentOrg();
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAYS);
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
    pipelinePlacementsForValue,
    cashForecastPlacements,
    rfClients,
    rfJobs,
    aceCandidates,
    momentumRowsRaw,
  ] = await Promise.all([
    // Pipeline COUNT — every active deal (offer + pending_start). The
    // dollar value comes from `pipelineValueAgg` below (sum of unpaid
    // invoices). We keep the placement-count read so the KPI tile can
    // still distinguish "no deals" from "deals exist but no invoice
    // rows yet" — `pipelineValueUsd == null && pipelineCount > 0` is
    // what surfaces the "fee unset" sub-label.
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { in: [...IN_PIPELINE_STAGES] },
      },
      select: { id: true },
    }),
    // Placed in the last 90 days — for Avg Fee Size and Days to Fill.
    // job.createdAtRf is the original RF posting date for backfilled rows;
    // job.createdAt falls back to when the Job row was created in Ace.
    // (Avg Fee Size intentionally still reads Placement.feeTotal: a
    // recruiter wants "what's a typical deal size?", a single value per
    // placement, not the sum of split-payment installments.)
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: NOT_CANCELLED,
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
        stage: NOT_CANCELLED,
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
        stage: NOT_CANCELLED,
        offerReceivedAt: { gte: ninetyDaysAgo, lte: now },
      },
    }),
    prisma.placement.aggregate({
      _count: { _all: true },
      where: {
        organizationId: org.id,
        stage: NOT_CANCELLED,
        placedAt: { gte: ninetyDaysAgo, lte: now },
      },
    }),
    // Pipeline VALUE — unpaid $ across every open placement (offer +
    // pending_start). Was a pure Invoice.aggregate, but that missed
    // pending_start placements with custom installment terms and no
    // Invoice rows yet — Ethan's case 2026-05-26 (inst1+inst2 set on
    // the placement, zero invoices, $0 pipeline). Routed through the
    // billing-events helper so custom-terms-without-invoices contribute
    // their scheduled installments alongside the actual invoice rows.
    // Collecting installment 1 still drops the pipeline value by exactly
    // inst1Amount (the corresponding event flips to status="paid").
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { in: [...IN_PIPELINE_STAGES] },
      },
      select: BILLING_EVENT_PLACEMENT_SELECT,
    }),
    // Cash Forecast — single placement query, then expand to billing
    // events and bucket in-process. Replaces the two raw Invoice
    // aggregates (which missed scheduled custom-term events with no
    // invoice row) plus the separate getInvoiceSummary call (which
    // double-counted SENT+PAID into Billed). Open placements + hired
    // (which still have outstanding installments to send/collect).
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { in: ["offer", "pending_start", "hired"] },
      },
      select: BILLING_EVENT_PLACEMENT_SELECT,
    }),
    // Pull RF client + job context so we can name Top Clients/Roles even
    // for RF-rooted placements. The MyDashboard tab already pays for the
    // same fetches; future opportunity is to share via a request cache.
    getRfClientsForOrg().catch(() => []),
    getRfJobsForOrg().catch(() => []),
    // Ace-native client + job names — pulled via the relations on the
    // momentum-row query below; this one is just for top-clients/top-roles.
    // Includes BILLING_EVENT_PLACEMENT_SELECT so per-placement deal size
    // (clientAgg feeUsd / roleAgg avgFeeUsd) reads sum-of-events instead
    // of bare feeTotal — Ethan's $7,500 custom-terms placement now shows
    // up in his client's column instead of contributing $0.
    prisma.placement.findMany({
      where: { organizationId: org.id, stage: NOT_CANCELLED },
      select: {
        ...BILLING_EVENT_PLACEMENT_SELECT,
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
    // Rejected placements drop out at the query level — a stale
    // offerReceivedAt on a since-rejected row was leaking into Recent
    // deal moves as "Offer extended" long after the deal died.
    // Includes BILLING_EVENT_PLACEMENT_SELECT so the "Placed · $X fee"
    // label uses placementTotalDollars instead of bare feeTotal —
    // custom-terms placements (Ethan) render their installment sum
    // rather than just "Placed" with no $.
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { notIn: ["rejected"] },
        OR: [
          { placedAt: { gte: new Date(now.getTime() - 30 * DAYS) } },
          { offerReceivedAt: { gte: new Date(now.getTime() - 30 * DAYS) } },
          // Surface a recently-cancelled deal as its own move even when
          // the placedAt/offerReceivedAt that put it on the books is older
          // than 30 days. A cancel is the row's last write, so updatedAt
          // is effectively the cancellation time.
          { stage: "cancelled", updatedAt: { gte: new Date(now.getTime() - 30 * DAYS) } },
        ],
      },
      select: {
        ...BILLING_EVENT_PLACEMENT_SELECT,
        stage: true,
        offerReceivedAt: true,
        updatedAt: true,
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
  // Pipeline VALUE — sum of every unpaid billing event across open
  // placements. paid events drop out (collected money isn't "pipeline").
  // future_draft + scheduled events count because the recruiter has
  // committed to those amounts even if the invoice isn't sendable yet —
  // this is the dollars-still-to-collect read.
  const pipelineValueCents = sumEventsCents(
    pipelinePlacementsForValue as PlacementForBilling[],
    (e) => e.status !== "paid",
  );
  const pipelineValueUsdRaw = Math.round(pipelineValueCents / 100);
  // Tile still wants null (renders "—") when there's nothing to show,
  // since the count column below distinguishes "no deals" from "deals
  // but no invoices yet".
  const pipelineValueUsd = pipelineValueUsdRaw > 0 ? pipelineValueUsdRaw : null;

  // Cash Forecast buckets, walked once over the placement set so the
  // same $3.75K never lands in two columns. See cashForecast comment
  // on the return type for the per-bucket contract.
  let pendingCents = 0;
  let pendingCount = 0;
  let billedCents = 0;
  let collectedCents = 0;
  for (const p of cashForecastPlacements) {
    for (const e of expandPlacementBillingEvents(p as PlacementForBilling)) {
      // Pending: unsent obligations. status=draft (real DRAFT invoice
      // row, isFuture=false — future_draft is excluded by the helper)
      // or status=scheduled (custom-terms installment with no invoice
      // row yet, OR feeTotal fallback). No date filter — the recruiter
      // wants the full unsent backlog.
      if (e.status === "draft" || e.status === "scheduled") {
        pendingCents += e.amountCents;
        pendingCount += 1;
      }
      // Billed: SENT invoices whose dueDate (scheduledAt for invoice
      // events) lands in the selected period. PAID intentionally
      // excluded — those graduated to Collected.
      if (e.status === "sent" && e.scheduledAt >= periodStart && e.scheduledAt < periodEnd) {
        billedCents += e.amountCents;
      }
      // Collected: PAID invoices bucketed by paidAt in the selected
      // period.
      if (
        e.status === "paid" &&
        e.paidAt &&
        e.paidAt >= periodStart &&
        e.paidAt < periodEnd
      ) {
        collectedCents += e.amountCents;
      }
    }
  }
  const pendingInvoicesUsd = Math.round(pendingCents / 100);
  const pendingInvoicesCount = pendingCount;
  const billedUsd = Math.round(billedCents / 100);
  const collectedUsd = Math.round(collectedCents / 100);
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

    // Per-placement deal size routed through the billing-events helper so
    // custom-terms placements (Ethan) read their installment sum
    // ($7,500) instead of feeTotal (null → $0). Returns null when the
    // placement truly has no fee captured yet — those still skip the
    // roleAgg fee accumulator (avg-fee math stays clean) but DO count
    // for the placements tally (the recruiter shipped a deal regardless
    // of whether the fee was logged).
    const placementFeeUsd = placementTotalDollars(p as PlacementForBilling);

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
      prev.feeUsd += placementFeeUsd ?? 0;
      clientAgg.set(clientKey, prev);
    }

    const roleTitle = p.job?.title
      ?? (p.jobRfId != null ? rfJobTitle.get(p.jobRfId) : null);
    if (roleTitle) {
      const prev = roleAgg.get(roleTitle) ?? { title: roleTitle, placements: 0, feeSum: 0, feeCount: 0 };
      prev.placements += 1;
      if (typeof placementFeeUsd === "number" && placementFeeUsd > 0) {
        prev.feeSum += placementFeeUsd;
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
      const candidateName = p.candidate
        ? [p.candidate.firstName, p.candidate.lastName].filter(Boolean).join(" ") || "(unnamed)"
        : p.candidateRfId != null
          ? `RF #${p.candidateRfId}`
          : "(unknown)";
      const clientName = p.client?.name
        ?? (p.clientRfId != null ? rfClientName.get(p.clientRfId) ?? "" : "");

      // Cancelled deals stay in the feed but read as a loss, dated to the
      // cancellation (updatedAt) rather than the now-void placedAt — so a
      // dead deal shows "Placement cancelled" instead of stale "Placed".
      if (p.stage === "cancelled") {
        return {
          id: p.id,
          candidateName,
          clientName,
          eventLabel: "Placement cancelled",
          eventAt: p.updatedAt,
          kind: "down" as const,
        };
      }

      const eventAt = p.placedAt ?? p.offerReceivedAt;
      if (!eventAt) return null;
      const placed = p.placedAt;
      const kind: "win" | "up" = placed ? "win" : "up";
      // Deal-size label uses the billing-events helper so a custom-terms
      // placement with no invoices yet (Ethan) still renders its
      // installment sum next to "Placed", not bare "Placed".
      const placementFeeUsd = placementTotalDollars(p as PlacementForBilling);
      const eventLabel = placed
        ? placementFeeUsd != null && placementFeeUsd > 0
          ? `Placed · ${formatMoneyShort(placementFeeUsd)} fee`
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
      pipelineValueUsd,
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
      pendingInvoicesUsd,
      pendingInvoicesCount,
      billedUsd,
      collectedUsd,
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
