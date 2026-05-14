import {
  CircleDollarSign,
  PercentCircle,
  Scale,
  Sparkles,
  Wallet,
} from "lucide-react";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ExpenseAddForm } from "@/app/dashboard/expense-add-form";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getMercuryTransactions,
  mercuryTransactionDescription,
} from "@/lib/mercury";
import {
  matchTransaction,
  shouldIgnoreTransaction,
} from "@/lib/mercury-matcher";
import {
  SubscriptionsList,
  type RecurringRow,
  type OneTimeRow,
  type MoneyInRow,
} from "@/app/dashboard/subscriptions-list";

const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}

function decimalToNumber(d: { toString(): string } | null): number {
  if (d == null) return 0;
  const n = Number(d.toString());
  return Number.isFinite(n) ? n : 0;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Net margin stays at 0% until Mercury (bank feed) wires in operating
// expenses beyond software tools — payroll, contractor pay, overhead.
// Until then we don't have the inputs to compute it honestly.
const NET_MARGIN_PLACEHOLDER_PCT = 0;
const QUARTERLY_REVENUE_GOAL_USD = 125_000;
const ANNUAL_REVENUE_GOAL_USD = 300_000;

// Placeholder offsets for contribution + net margin until Mercury
// categorizes variable costs (per-placement spend) and ops (software,
// payroll, owner draw) separately. Shown in the on-card footnote.
const CONTRIBUTION_MARGIN_DRAG_PCT = 5;
const NET_MARGIN_DRAG_PCT = 10;

// Section selector lets the /finances page slice this surface into its
// "Revenue & Profitability" tab and its "Expenses" tab without
// duplicating any of the data-loading work below.
export type FinancialPerformanceMode =
  | "full"
  | "revenue-profitability"
  | "expenses";

export async function FinancialPerformanceTab({
  mode = "full",
}: {
  mode?: FinancialPerformanceMode;
} = {}) {
  const org = await getCurrentOrg();
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  // Current calendar quarter bounds — for the Trend card. Months are
  // 0-indexed (April = 3, June = 5), so qStartMonth jumps in steps of 3.
  const currentMonth = now.getMonth();
  const currentQuarterIndex = Math.floor(currentMonth / 3);
  const qStartMonth = currentQuarterIndex * 3;
  const qStart = new Date(year, qStartMonth, 1);
  const qEnd = new Date(year, qStartMonth + 3, 1);

  // Mercury fetch needs the org's API key, which lives on the
  // Organization row. We chain the key lookup into the upstream call so
  // the network request fires as soon as the key resolves, in parallel
  // with the unrelated prisma queries below.
  const mercuryKeyPromise = prisma.organization
    .findUnique({
      where: { id: org.id },
      select: { mercuryApiKey: true },
    })
    .then((o) => o?.mercuryApiKey ?? null);
  const mercuryTxnsPromise = mercuryKeyPromise.then((key) =>
    key ? getMercuryTransactions(key) : [],
  );

  const [
    revenueInvoices,
    placementsYtd,
    placementsHiredYtd,
    mercuryApiKey,
    mercuryTxnsAll,
    manualExpenses,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: { in: ["SENT", "PAID"] },
        OR: [
          { sentAt: { gte: yearStart, lt: yearEnd } },
          { paidAt: { gte: yearStart, lt: yearEnd } },
        ],
      },
      select: {
        feeAmount: true,
        sentAt: true,
        paidAt: true,
        clientId: true,
        client: { select: { name: true } },
        placement: { select: { candidateSource: true } },
      },
    }),
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        placedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { clientId: true, candidateSource: true },
    }),
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: "hired",
        placedAt: { gte: yearStart, lt: yearEnd },
      },
      select: {
        id: true,
        feeTotal: true,
        placedAt: true,
        candidateRfId: true,
        candidate: { select: { firstName: true, lastName: true } },
      },
      orderBy: { placedAt: "desc" },
    }),
    mercuryKeyPromise,
    mercuryTxnsPromise,
    // Manually-entered subscriptions / one-time tool spend from the
    // "Add expense" form. Merged into the same recurring/one-time
    // buckets below so they appear alongside Mercury-matched rows.
    prisma.toolExpense.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const revenueUsd = revenueInvoices.reduce(
    (sum, r) => sum + decimalToNumber(r.feeAmount),
    0,
  );

  // ---- Revenue section data ----

  const periodLabel = `YTD · Jan 1 – ${MONTH_SHORT[currentMonth]} ${now.getDate()}, ${year}`;

  // Placement counts per client + per source (YTD).
  const placementsByClient = new Map<string, number>();
  const placementsBySource = new Map<string, number>();
  for (const p of placementsYtd) {
    if (p.clientId) {
      placementsByClient.set(
        p.clientId,
        (placementsByClient.get(p.clientId) ?? 0) + 1,
      );
    }
    const src = p.candidateSource?.trim() || "Untagged";
    placementsBySource.set(src, (placementsBySource.get(src) ?? 0) + 1);
  }
  const totalPlacementsYtd = placementsYtd.length;

  // By Client: aggregate invoice revenue per client.
  type ClientRow = {
    id: string;
    name: string;
    revenueUsd: number;
    placements: number;
  };
  const byClientMap = new Map<string, ClientRow>();
  for (const inv of revenueInvoices) {
    const id = inv.clientId ?? "__unattached__";
    const name = inv.client?.name ?? "Unattached";
    const existing = byClientMap.get(id) ?? {
      id,
      name,
      revenueUsd: 0,
      placements: id === "__unattached__" ? 0 : (placementsByClient.get(id) ?? 0),
    };
    existing.revenueUsd += decimalToNumber(inv.feeAmount);
    byClientMap.set(id, existing);
  }
  const byClientAll = Array.from(byClientMap.values()).sort(
    (a, b) => b.revenueUsd - a.revenueUsd,
  );
  const byClientTotalUsd = byClientAll.reduce((s, r) => s + r.revenueUsd, 0);
  const byClientTop = byClientAll.slice(0, 6);
  const byClientOthers = byClientAll.slice(6);
  const byClientOthersUsd = byClientOthers.reduce(
    (s, r) => s + r.revenueUsd,
    0,
  );
  const byClientMaxUsd = byClientTop[0]?.revenueUsd ?? 0;

  // By Source: aggregate invoice revenue by placement.candidateSource.
  type SourceRow = { source: string; revenueUsd: number; placements: number };
  const bySourceMap = new Map<string, number>();
  for (const inv of revenueInvoices) {
    const src = inv.placement?.candidateSource?.trim() || "Untagged";
    bySourceMap.set(src, (bySourceMap.get(src) ?? 0) + decimalToNumber(inv.feeAmount));
  }
  const bySourceAll: SourceRow[] = Array.from(bySourceMap, ([source, revenueUsd]) => ({
    source,
    revenueUsd,
    placements: placementsBySource.get(source) ?? 0,
  })).sort((a, b) => b.revenueUsd - a.revenueUsd);
  const bySourceTotalUsd = bySourceAll.reduce((s, r) => s + r.revenueUsd, 0);
  const bySourceTop = bySourceAll.slice(0, 6);
  const bySourceOthers = bySourceAll.slice(6);
  const bySourceOthersUsd = bySourceOthers.reduce(
    (s, r) => s + r.revenueUsd,
    0,
  );
  const bySourceMaxUsd = bySourceTop[0]?.revenueUsd ?? 0;

  // Trend card: revenue per month inside the current calendar quarter.
  const quarterMonths = [qStartMonth, qStartMonth + 1, qStartMonth + 2];
  const monthlyRevenue = new Map<number, number>();
  quarterMonths.forEach((m) => monthlyRevenue.set(m, 0));
  for (const inv of revenueInvoices) {
    const refDate = inv.paidAt ?? inv.sentAt;
    if (!refDate) continue;
    if (refDate.getFullYear() !== year) continue;
    const m = refDate.getMonth();
    if (m < qStartMonth || m >= qStartMonth + 3) continue;
    monthlyRevenue.set(
      m,
      (monthlyRevenue.get(m) ?? 0) + decimalToNumber(inv.feeAmount),
    );
  }
  const quarterRevenueUsd = quarterMonths.reduce(
    (s, m) => s + (monthlyRevenue.get(m) ?? 0),
    0,
  );
  const maxMonthUsd = Math.max(
    1,
    ...quarterMonths.map((m) => monthlyRevenue.get(m) ?? 0),
  );

  // Linear pacing forecast across the quarter — projects current actuals
  // out to a full-quarter total based on days elapsed.
  const dayMs = 24 * 60 * 60 * 1000;
  const daysElapsedInQuarter = Math.max(
    1,
    Math.floor((now.getTime() - qStart.getTime()) / dayMs) + 1,
  );
  const daysInQuarter = Math.round((qEnd.getTime() - qStart.getTime()) / dayMs);
  const forecastQuarterUsd =
    quarterRevenueUsd > 0
      ? (quarterRevenueUsd / daysElapsedInQuarter) * daysInQuarter
      : 0;

  const quarterLabel = `Q${currentQuarterIndex + 1} ${year}`;

  // ---- Expenses section data ----
  // Catalog drives the recurring sections — Mercury matches enrich each
  // catalog row with a Total Paid YTD figure. Any Mercury debit that
  // matches a known tool family but falls outside ±30% of the catalog
  // price drops into the one-time section instead (e.g. OpenPhone has
  // a $35.64 recurring charge plus ad-hoc $1.40 / $19.50 fees, all
  // sharing the "OpenPhone / Quo" matcher name).
  const mercuryConnected = mercuryApiKey != null;
  const mercuryTxns = mercuryTxnsAll.filter((t) => {
    const stamp = t.postedAt ?? t.createdAt;
    if (!stamp) return false;
    return new Date(stamp).getFullYear() === year;
  });

  type RecurringCatalogEntry = {
    displayName: string;
    matcherName: string;
    catalogCost: number;
  };
  const RECURRING_MONTHLY_CATALOG: RecurringCatalogEntry[] = [
    { displayName: "Pin", matcherName: "Pin", catalogCost: 299 },
    { displayName: "Anthropic / Claude Code", matcherName: "Anthropic / Claude", catalogCost: 100 },
    { displayName: "TheirStack", matcherName: "TheirStack", catalogCost: 58.95 },
    { displayName: "OpenPhone / Quo", matcherName: "OpenPhone / Quo", catalogCost: 35.64 },
    { displayName: "Vercel", matcherName: "Vercel", catalogCost: 21.6 },
    { displayName: "OpenAI / ChatGPT", matcherName: "OpenAI / ChatGPT", catalogCost: 20 },
  ];
  const RECURRING_ANNUAL_CATALOG: RecurringCatalogEntry[] = [
    { displayName: "Apollo", matcherName: "Apollo", catalogCost: 500 },
    { displayName: "Zoho", matcherName: "Zoho", catalogCost: 104 },
  ];

  // Anthropic txns that aren't the Claude subscription are pay-as-you-go
  // Console charges. Same matcher tool name, different display in the
  // one-time bucket.
  const ANTHROPIC_MATCHER_NAME = "Anthropic / Claude";
  const ANTHROPIC_CONSOLE_DISPLAY = "Anthropic Console";

  const RECURRING_TOLERANCE = 0.3;
  const inRecurringWindow = (amount: number, target: number) =>
    Math.abs(amount - target) / target <= RECURRING_TOLERANCE;

  type RecurringAgg = { totalUsd: number; paidCount: number };
  const monthlyAgg = new Map<string, RecurringAgg>();
  const annualAgg = new Map<string, RecurringAgg>();
  const oneTimeRowsRaw: OneTimeRow[] = [];
  const cashbackTxns: { amount: number; date: Date | null; key: string }[] = [];

  for (const t of mercuryTxns) {
    const description = mercuryTransactionDescription(t);
    const cp = (t.counterpartyName ?? "").toLowerCase();
    const bd = (t.bankDescription ?? "").toLowerCase();
    const isCashback = cp.includes("io cashback") || bd.includes("io cashback");

    if (isCashback) {
      const raw = Number(t.amount ?? 0);
      if (!Number.isFinite(raw)) continue;
      const stamp = t.postedAt ?? t.createdAt;
      cashbackTxns.push({
        amount: raw,
        date: stamp ? new Date(stamp) : null,
        key: `cashback-${t.id ?? `${stamp}-${raw}`}`,
      });
      continue;
    }

    if (shouldIgnoreTransaction(t)) continue;
    if (!description) continue;
    const tool = matchTransaction(description);
    if (!tool) continue;
    const raw = Number(t.amount ?? 0);
    if (!Number.isFinite(raw)) continue;
    const spend = -raw;
    if (spend <= 0) continue;

    const monthlyHit = RECURRING_MONTHLY_CATALOG.find(
      (c) => c.matcherName === tool && inRecurringWindow(spend, c.catalogCost),
    );
    if (monthlyHit) {
      const prev = monthlyAgg.get(monthlyHit.displayName) ?? {
        totalUsd: 0,
        paidCount: 0,
      };
      prev.totalUsd += spend;
      prev.paidCount += 1;
      monthlyAgg.set(monthlyHit.displayName, prev);
      continue;
    }

    const annualHit = RECURRING_ANNUAL_CATALOG.find(
      (c) => c.matcherName === tool && inRecurringWindow(spend, c.catalogCost),
    );
    if (annualHit) {
      const prev = annualAgg.get(annualHit.displayName) ?? {
        totalUsd: 0,
        paidCount: 0,
      };
      prev.totalUsd += spend;
      prev.paidCount += 1;
      annualAgg.set(annualHit.displayName, prev);
      continue;
    }

    const displayName =
      tool === ANTHROPIC_MATCHER_NAME ? ANTHROPIC_CONSOLE_DISPLAY : tool;
    const stamp = t.postedAt ?? t.createdAt;
    oneTimeRowsRaw.push({
      key: `merc-onetime-${t.id ?? `${displayName}-${stamp}-${spend}`}`,
      toolName: displayName,
      amountUsd: spend,
      date: stamp ? new Date(stamp) : null,
    });
  }

  const recurringMonthly: RecurringRow[] = RECURRING_MONTHLY_CATALOG.map((c) => {
    const agg = monthlyAgg.get(c.displayName) ?? { totalUsd: 0, paidCount: 0 };
    return {
      key: `mo-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: agg.totalUsd,
      paidCount: agg.paidCount,
    };
  });
  const recurringAnnual: RecurringRow[] = RECURRING_ANNUAL_CATALOG.map((c) => {
    const agg = annualAgg.get(c.displayName) ?? { totalUsd: 0, paidCount: 0 };
    return {
      key: `yr-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: agg.totalUsd,
      paidCount: agg.paidCount,
    };
  });

  // Manual entries from the "Add expense" form route into the bucket
  // that matches their frequency. Quarterly is normalized into the
  // monthly recurring section so its standing cost still flows into
  // the monthly-recurring tile (catalogCost = cost/3 monthly equivalent).
  for (const m of manualExpenses) {
    const paidCount = m.paidCount > 0 ? m.paidCount : 1;
    const totalYtdUsd = m.cost * paidCount;
    const freq = m.frequency.trim().toLowerCase();
    if (freq === "monthly") {
      recurringMonthly.push({
        key: `manual-mo-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost,
        totalYtdUsd,
        paidCount,
      });
    } else if (freq === "quarterly") {
      recurringMonthly.push({
        key: `manual-q-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost / 3,
        totalYtdUsd,
        paidCount,
      });
    } else if (freq === "annual" || freq === "annually" || freq === "yearly") {
      recurringAnnual.push({
        key: `manual-yr-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost,
        totalYtdUsd,
        paidCount,
      });
    } else {
      // "One-time" and any other unrecognized frequency falls through
      // to the one-time list — best surface for a single charge.
      oneTimeRowsRaw.push({
        key: `manual-onetime-${m.id}`,
        toolName: m.name,
        amountUsd: totalYtdUsd,
        date: m.startDate ?? m.createdAt ?? null,
      });
    }
  }

  oneTimeRowsRaw.sort((a, b) => {
    const at = a.date?.getTime() ?? 0;
    const bt = b.date?.getTime() ?? 0;
    return bt - at;
  });
  const oneTimeRows = oneTimeRowsRaw;

  // ---- Money In section data ----
  const placementMoneyInRows: MoneyInRow[] = placementsHiredYtd.map((p) => {
    const name =
      [p.candidate?.firstName, p.candidate?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      (p.candidateRfId != null ? `RF candidate #${p.candidateRfId}` : "Unknown candidate");
    return {
      key: `placement-${p.id}`,
      name,
      source: "Placement",
      amountUsd: p.feeTotal ?? 0,
      date: p.placedAt ?? null,
    };
  });
  const cashbackMoneyInRows: MoneyInRow[] = cashbackTxns.map((c) => ({
    key: c.key,
    name: "Mercury Cashback",
    source: "Mercury Cashback",
    amountUsd: c.amount,
    date: c.date,
  }));
  const moneyInRows = [...placementMoneyInRows, ...cashbackMoneyInRows].sort(
    (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
  );

  // ---- Aggregates ----
  const monthlyRecurringSubtotal = recurringMonthly.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const annualRecurringSubtotal = recurringAnnual.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const oneTimeSubtotal = oneTimeRows.reduce((s, r) => s + r.amountUsd, 0);
  const subscriptionsYtdUsd =
    monthlyRecurringSubtotal + annualRecurringSubtotal + oneTimeSubtotal;

  const activeSubscriptionsCount =
    recurringMonthly.filter((r) => r.paidCount > 0).length +
    recurringAnnual.filter((r) => r.paidCount > 0).length;

  // Monthly recurring cost — sum of catalog monthly costs + annual/12,
  // counting only catalog rows that Mercury has actually charged YTD.
  const monthlyRecurringUsd =
    recurringMonthly
      .filter((r) => r.paidCount > 0)
      .reduce((s, r) => s + r.catalogCost, 0) +
    recurringAnnual
      .filter((r) => r.paidCount > 0)
      .reduce((s, r) => s + r.catalogCost / 12, 0);

  // KPI strip math reuses subscriptionsYtdUsd so the top-of-page tile
  // always matches the YTD subtotal under the Subscriptions card.
  const expensesUsd = subscriptionsYtdUsd;
  const grossMarginPct =
    revenueUsd > 0 ? ((revenueUsd - expensesUsd) / revenueUsd) * 100 : null;
  const blendedRoiPct =
    expensesUsd > 0 ? ((revenueUsd - expensesUsd) / expensesUsd) * 100 : null;
  const grossMarginLabel =
    grossMarginPct != null ? `${grossMarginPct.toFixed(1)}%` : "—";
  const netMarginLabel = `${NET_MARGIN_PLACEHOLDER_PCT.toFixed(1)}%`;
  const roiLabel =
    blendedRoiPct != null ? `${Math.round(blendedRoiPct)}%` : "—";

  // Revenue attribution by source name (case-insensitive). Each
  // invoice carries the placement.candidateSource that the recruiter
  // tagged at the sourcing step — the first-touch attribution model.
  const revByLowerSource = new Map<string, number>();
  for (const inv of revenueInvoices) {
    const src = inv.placement?.candidateSource?.trim();
    if (!src) continue;
    const key = src.toLowerCase();
    revByLowerSource.set(
      key,
      (revByLowerSource.get(key) ?? 0) + decimalToNumber(inv.feeAmount),
    );
  }

  // Roll up YTD spend per display name across all three expense sections
  // so ROI lines can show one row per tool family rather than separate
  // recurring vs one-time entries.
  const spendByDisplayName = new Map<string, number>();
  const bump = (name: string, usd: number) => {
    spendByDisplayName.set(name, (spendByDisplayName.get(name) ?? 0) + usd);
  };
  for (const r of recurringMonthly) {
    if (r.totalYtdUsd > 0) bump(r.toolName, r.totalYtdUsd);
  }
  for (const r of recurringAnnual) {
    if (r.totalYtdUsd > 0) bump(r.toolName, r.totalYtdUsd);
  }
  for (const r of oneTimeRows) bump(r.toolName, r.amountUsd);

  const roiRows: RoiRow[] = Array.from(spendByDisplayName.entries())
    .map(([toolName, spendUsd]) => {
      const rev = revByLowerSource.get(toolName.toLowerCase()) ?? 0;
      const roiPct =
        spendUsd > 0 && rev > 0
          ? ((rev - spendUsd) / spendUsd) * 100
          : null;
      return {
        key: `roi-${toolName}`,
        toolName,
        spendUsd,
        revUsd: rev,
        roiPct,
      };
    })
    .sort((a, b) => b.spendUsd - a.spendUsd);

  const totalRoiSpend = roiRows.reduce((s, r) => s + r.spendUsd, 0);
  const totalRoiRev = roiRows.reduce((s, r) => s + r.revUsd, 0);
  const blendedExpensesRoiPct =
    totalRoiSpend > 0
      ? ((totalRoiRev - totalRoiSpend) / totalRoiSpend) * 100
      : null;

  // ---- Profitability section data ----
  // ET-explicit day-of-quarter / day-of-year counters. Vercel runs in
  // UTC; without explicit ET parts the day counter would tick over at
  // 8pm ET in the recruiter's view.
  const ET_DAY_MS = 86_400_000;
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const etGet = (t: string) =>
    Number(etParts.find((p) => p.type === t)?.value ?? 0);
  const etYear = etGet("year");
  const etMonth = etGet("month");
  const etDay = etGet("day");
  const etQStartMonth1 = Math.floor((etMonth - 1) / 3) * 3 + 1;
  const etDayOfQuarter =
    Math.floor(
      (Date.UTC(etYear, etMonth - 1, etDay) -
        Date.UTC(etYear, etQStartMonth1 - 1, 1)) /
        ET_DAY_MS,
    ) + 1;
  const etDaysInQuarter = Math.round(
    (Date.UTC(etYear, etQStartMonth1 + 2, 1) -
      Date.UTC(etYear, etQStartMonth1 - 1, 1)) /
      ET_DAY_MS,
  );
  const etDayOfYear =
    Math.floor(
      (Date.UTC(etYear, etMonth - 1, etDay) - Date.UTC(etYear, 0, 1)) /
        ET_DAY_MS,
    ) + 1;
  const etDaysInYear = Math.round(
    (Date.UTC(etYear + 1, 0, 1) - Date.UTC(etYear, 0, 1)) / ET_DAY_MS,
  );
  const etPctOfQuarter = (etDayOfQuarter / etDaysInQuarter) * 100;
  const etPctOfYear = (etDayOfYear / etDaysInYear) * 100;

  // Margins reuse the KPI strip totals. Contribution and net carry the
  // placeholder drags until Mercury feeds variable + ops costs.
  const grossMarginProfPct =
    revenueUsd > 0 ? ((revenueUsd - expensesUsd) / revenueUsd) * 100 : null;
  const contributionMarginProfPct =
    grossMarginProfPct != null
      ? grossMarginProfPct - CONTRIBUTION_MARGIN_DRAG_PCT
      : null;
  const netMarginProfPct =
    grossMarginProfPct != null
      ? grossMarginProfPct - NET_MARGIN_DRAG_PCT
      : null;

  const fmtPct1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
  const fmtPctInt = (n: number) => `${Math.round(n)}%`;

  // Pacing math — points = % to goal minus % of period elapsed.
  // Positive means ahead of a flat-pace plan; negative means behind.
  const qPctToGoal = (quarterRevenueUsd / QUARTERLY_REVENUE_GOAL_USD) * 100;
  const qToGoUsd = Math.max(0, QUARTERLY_REVENUE_GOAL_USD - quarterRevenueUsd);
  const qPacingPts = qPctToGoal - etPctOfQuarter;
  const qPacingLabel = (() => {
    const rounded = Math.round(Math.abs(qPacingPts));
    if (rounded === 0) return "on pace";
    return qPacingPts >= 0 ? `+${rounded} pts ahead` : `-${rounded} pts behind`;
  })();

  const annualPctToGoal = (revenueUsd / ANNUAL_REVENUE_GOAL_USD) * 100;
  const annualToGoUsd = Math.max(0, ANNUAL_REVENUE_GOAL_USD - revenueUsd);
  const annualForecastUsd =
    etDayOfYear > 0 ? (revenueUsd / etDayOfYear) * etDaysInYear : 0;

  const avgFeeUsd =
    totalPlacementsYtd > 0 ? revenueUsd / totalPlacementsYtd : 0;

  const marginsCardData: MarginsCardData = {
    grossLabel: fmtPct1(grossMarginProfPct),
    contributionLabel: fmtPct1(contributionMarginProfPct),
    netLabel: fmtPct1(netMarginProfPct),
    revenueFormatted: formatUsd(revenueUsd),
    expensesFormatted: formatUsd(expensesUsd),
  };

  const goalPacingData: GoalPacingCardData = {
    quarter: {
      eyebrow: `${quarterLabel.toUpperCase()} · QUARTERLY GOAL`,
      revenueFormatted: formatUsd(quarterRevenueUsd),
      goalFormatted: formatUsd(QUARTERLY_REVENUE_GOAL_USD),
      pctToGoal: qPctToGoal,
      pctToGoalLabel: fmtPctInt(qPctToGoal),
      dayOfQuarter: etDayOfQuarter,
      daysInQuarter: etDaysInQuarter,
      pctOfQuarterLabel: fmtPctInt(etPctOfQuarter),
      toGoFormatted: formatUsd(qToGoUsd),
      pacingLabel: qPacingLabel,
    },
    annual: {
      eyebrow: `FY ${etYear} · ANNUAL GOAL`,
      revenueFormatted: formatUsd(revenueUsd),
      goalFormatted: formatUsd(ANNUAL_REVENUE_GOAL_USD),
      pctToGoal: annualPctToGoal,
      pctToGoalLabel: fmtPctInt(annualPctToGoal),
      dayOfYear: etDayOfYear,
      daysInYear: etDaysInYear,
      pctOfYearLabel: fmtPctInt(etPctOfYear),
      toGoFormatted: formatUsd(annualToGoUsd),
      forecastFormatted: formatUsd(annualForecastUsd),
    },
    avgFeeFormatted: formatUsd(avgFeeUsd),
    placementsYtd: totalPlacementsYtd,
  };

  const showRevenueProfitability =
    mode === "full" || mode === "revenue-profitability";
  const showExpenses = mode === "full" || mode === "expenses";

  return (
    <div className="flex flex-col gap-6">
      {showRevenueProfitability && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile
            label="Total Revenue YTD"
            value={formatUsd(revenueUsd)}
            icon={CircleDollarSign}
            live={revenueUsd > 0}
          />
          <KpiTile
            label="Gross Margin"
            value={grossMarginLabel}
            icon={PercentCircle}
            live={grossMarginPct != null && grossMarginPct > 0}
          />
          <KpiTile label="Net Margin" value={netMarginLabel} icon={Scale} />
          <KpiTile
            label="Total Expenses YTD"
            value={formatUsd(expensesUsd)}
            icon={Wallet}
            live={expensesUsd > 0}
          />
          <KpiTile
            label="Blended ROI"
            value={roiLabel}
            icon={Sparkles}
            live={blendedRoiPct != null && blendedRoiPct > 0}
          />
        </div>
      )}

      {showRevenueProfitability && (
        <RevenueSection
          periodLabel={periodLabel}
          byClientTop={byClientTop}
          byClientOthersCount={byClientOthers.length}
          byClientOthersUsd={byClientOthersUsd}
          byClientTotalUsd={byClientTotalUsd}
          byClientMaxUsd={byClientMaxUsd}
          totalPlacementsYtd={totalPlacementsYtd}
          bySourceTop={bySourceTop}
          bySourceOthersCount={bySourceOthers.length}
          bySourceOthersUsd={bySourceOthersUsd}
          bySourceTotalUsd={bySourceTotalUsd}
          bySourceMaxUsd={bySourceMaxUsd}
          quarterLabel={quarterLabel}
          quarterMonths={quarterMonths}
          currentMonth={currentMonth}
          monthlyRevenue={monthlyRevenue}
          maxMonthUsd={maxMonthUsd}
          quarterRevenueUsd={quarterRevenueUsd}
          forecastQuarterUsd={forecastQuarterUsd}
        />
      )}

      {showExpenses && (
        <ExpensesSection
          mercuryConnected={mercuryConnected}
          recurringMonthly={recurringMonthly}
          recurringAnnual={recurringAnnual}
          oneTimeRows={oneTimeRows}
          moneyInRows={moneyInRows}
          subscriptionsYtdUsd={subscriptionsYtdUsd}
          activeSubscriptionsCount={activeSubscriptionsCount}
          monthlyRecurringUsd={monthlyRecurringUsd}
          roiRows={roiRows}
          blendedExpensesRoiPct={blendedExpensesRoiPct}
        />
      )}

      {showRevenueProfitability && (
        <ProfitabilitySection
          margins={marginsCardData}
          goalPacing={goalPacingData}
        />
      )}
    </div>
  );
}

type RoiRow = {
  key: string;
  toolName: string;
  spendUsd: number;
  revUsd: number;
  roiPct: number | null;
};

type ClientRow = {
  id: string;
  name: string;
  revenueUsd: number;
  placements: number;
};
type SourceRow = { source: string; revenueUsd: number; placements: number };

function RevenueSection({
  periodLabel,
  byClientTop,
  byClientOthersCount,
  byClientOthersUsd,
  byClientTotalUsd,
  byClientMaxUsd,
  totalPlacementsYtd,
  bySourceTop,
  bySourceOthersCount,
  bySourceOthersUsd,
  bySourceTotalUsd,
  bySourceMaxUsd,
  quarterLabel,
  quarterMonths,
  currentMonth,
  monthlyRevenue,
  maxMonthUsd,
  quarterRevenueUsd,
  forecastQuarterUsd,
}: {
  periodLabel: string;
  byClientTop: ClientRow[];
  byClientOthersCount: number;
  byClientOthersUsd: number;
  byClientTotalUsd: number;
  byClientMaxUsd: number;
  totalPlacementsYtd: number;
  bySourceTop: SourceRow[];
  bySourceOthersCount: number;
  bySourceOthersUsd: number;
  bySourceTotalUsd: number;
  bySourceMaxUsd: number;
  quarterLabel: string;
  quarterMonths: number[];
  currentMonth: number;
  monthlyRevenue: Map<number, number>;
  maxMonthUsd: number;
  quarterRevenueUsd: number;
  forecastQuarterUsd: number;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="font-serif text-xl font-extrabold tracking-tight text-court-fg sm:text-2xl">
          Revenue
        </h3>
        <p className="text-xs text-court-fg-muted">{periodLabel}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ByClientCard
          rows={byClientTop}
          othersCount={byClientOthersCount}
          othersUsd={byClientOthersUsd}
          totalUsd={byClientTotalUsd}
          maxUsd={byClientMaxUsd}
          totalPlacementsYtd={totalPlacementsYtd}
        />
        <BySourceCard
          rows={bySourceTop}
          othersCount={bySourceOthersCount}
          othersUsd={bySourceOthersUsd}
          totalUsd={bySourceTotalUsd}
          maxUsd={bySourceMaxUsd}
        />
        <TrendCard
          quarterLabel={quarterLabel}
          quarterMonths={quarterMonths}
          currentMonth={currentMonth}
          monthlyRevenue={monthlyRevenue}
          maxMonthUsd={maxMonthUsd}
          quarterRevenueUsd={quarterRevenueUsd}
          forecastQuarterUsd={forecastQuarterUsd}
        />
      </div>
    </section>
  );
}

function ByClientCard({
  rows,
  othersCount,
  othersUsd,
  totalUsd,
  maxUsd,
  totalPlacementsYtd,
}: {
  rows: ClientRow[];
  othersCount: number;
  othersUsd: number;
  totalUsd: number;
  maxUsd: number;
  totalPlacementsYtd: number;
}) {
  return (
    <Panel
      title="By client"
      subline={`Top earners · ${totalPlacementsYtd} placement${
        totalPlacementsYtd === 1 ? "" : "s"
      } YTD`}
    >
      {rows.length === 0 ? (
        <EmptyBlock>No billed revenue logged this year yet.</EmptyBlock>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <BarRow
              key={r.id}
              name={r.name}
              count={r.placements}
              revenueUsd={r.revenueUsd}
              pctOfTotal={totalUsd > 0 ? (r.revenueUsd / totalUsd) * 100 : 0}
              pctOfMax={maxUsd > 0 ? (r.revenueUsd / maxUsd) * 100 : 0}
            />
          ))}
          {othersCount > 0 && (
            <OthersRow count={othersCount} revenueUsd={othersUsd} totalUsd={totalUsd} />
          )}
        </ul>
      )}
    </Panel>
  );
}

function BySourceCard({
  rows,
  othersCount,
  othersUsd,
  totalUsd,
  maxUsd,
}: {
  rows: SourceRow[];
  othersCount: number;
  othersUsd: number;
  totalUsd: number;
  maxUsd: number;
}) {
  return (
    <Panel
      title="By source"
      subline="How the deal entered the desk"
    >
      {rows.length === 0 ? (
        <EmptyBlock>No billed revenue logged this year yet.</EmptyBlock>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <BarRow
              key={r.source}
              name={r.source}
              count={r.placements}
              revenueUsd={r.revenueUsd}
              pctOfTotal={totalUsd > 0 ? (r.revenueUsd / totalUsd) * 100 : 0}
              pctOfMax={maxUsd > 0 ? (r.revenueUsd / maxUsd) * 100 : 0}
            />
          ))}
          {othersCount > 0 && (
            <OthersRow count={othersCount} revenueUsd={othersUsd} totalUsd={totalUsd} />
          )}
        </ul>
      )}
    </Panel>
  );
}

function Panel({
  title,
  subline,
  children,
}: {
  title: string;
  subline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
        {title}
      </p>
      <p className="mt-0.5 text-xs text-court-fg-muted">{subline}</p>
      {children}
    </div>
  );
}

function BarRow({
  name,
  count,
  revenueUsd,
  pctOfTotal,
  pctOfMax,
}: {
  name: string;
  count: number;
  revenueUsd: number;
  pctOfTotal: number;
  pctOfMax: number;
}) {
  // Bar width tracks share-of-max so the leader fills the row and
  // everything else reads relative to it. The text "%" column shows
  // share-of-total so the four columns sum cleanly.
  const pctLabel = `${Math.round(pctOfTotal)}%`;
  return (
    <li>
      <div className="px-1 py-1.5">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-court-fg">
            {name}
          </div>
          <div className="shrink-0 text-xs tabular-nums text-court-fg-muted">
            {count}
          </div>
          <div className="shrink-0 text-sm font-semibold tabular-nums tracking-tight text-court-fg">
            {formatUsd(revenueUsd)}
          </div>
          <div className="w-9 shrink-0 text-right text-xs tabular-nums text-court-fg-muted">
            {pctLabel}
          </div>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-court-surface-subtle">
          <div
            className="h-full rounded-full bg-court-brand"
            style={{ width: `${Math.max(0, Math.min(100, pctOfMax))}%` }}
          />
        </div>
      </div>
    </li>
  );
}

function OthersRow({
  count,
  revenueUsd,
  totalUsd,
}: {
  count: number;
  revenueUsd: number;
  totalUsd: number;
}) {
  const pct = totalUsd > 0 ? Math.round((revenueUsd / totalUsd) * 100) : 0;
  return (
    <li className="px-1 py-1.5">
      <div className="flex items-baseline gap-3">
        <div className="min-w-0 flex-1 truncate text-sm text-court-fg-muted">
          All others ({count})
        </div>
        <div className="shrink-0 text-sm font-medium tabular-nums text-court-fg-muted">
          {formatUsd(revenueUsd)}
        </div>
        <div className="w-9 shrink-0 text-right text-xs tabular-nums text-court-fg-muted">
          {pct}%
        </div>
      </div>
    </li>
  );
}

function TrendCard({
  quarterLabel,
  quarterMonths,
  currentMonth,
  monthlyRevenue,
  maxMonthUsd,
  quarterRevenueUsd,
  forecastQuarterUsd,
}: {
  quarterLabel: string;
  quarterMonths: number[];
  currentMonth: number;
  monthlyRevenue: Map<number, number>;
  maxMonthUsd: number;
  quarterRevenueUsd: number;
  forecastQuarterUsd: number;
}) {
  const progressLabel = `${formatUsd(quarterRevenueUsd)} / ${formatUsd(
    QUARTERLY_REVENUE_GOAL_USD,
  )}`;
  const forecastLabel = `${formatUsd(forecastQuarterUsd)} forecast ${quarterLabel} close`;

  return (
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
            Trend · {quarterLabel}
          </p>
          <p className="mt-0.5 text-xs text-court-fg-muted">
            Monthly close-out vs {formatUsd(QUARTERLY_REVENUE_GOAL_USD)} quarterly goal
          </p>
        </div>
        <div className="shrink-0 text-right text-xs font-semibold tabular-nums text-court-fg">
          {progressLabel}
        </div>
      </div>

      <div className="mt-4 flex h-28 items-end gap-3">
        {quarterMonths.map((m) => {
          const usd = monthlyRevenue.get(m) ?? 0;
          const heightPct = maxMonthUsd > 0 ? (usd / maxMonthUsd) * 100 : 0;
          const isFuture = m > currentMonth;
          const isCurrent = m === currentMonth;
          return (
            <div key={m} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="relative flex h-full w-full items-end">
                {isFuture ? (
                  <div className="h-full w-full rounded-md border border-dashed border-court-border bg-transparent" />
                ) : (
                  <div
                    className={
                      "w-full rounded-md " +
                      (isCurrent ? "bg-court-brand/60" : "bg-court-brand")
                    }
                    style={{ height: `${Math.max(4, heightPct)}%` }}
                  />
                )}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-court-fg-muted">
                {MONTH_FULL[m].slice(0, 3)}
              </div>
              <div className="text-[11px] font-semibold tabular-nums text-court-fg">
                {isFuture ? "—" : formatUsd(usd)}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-court-fg-muted">{forecastLabel}</p>
    </div>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-court-border bg-court-surface-subtle px-3 py-4 text-center text-xs text-court-fg-muted">
      {children}
    </div>
  );
}

const ROI_INT_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function avatarFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

function ExpensesSection({
  mercuryConnected,
  recurringMonthly,
  recurringAnnual,
  oneTimeRows,
  moneyInRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  monthlyRecurringUsd,
  roiRows,
  blendedExpensesRoiPct,
}: {
  mercuryConnected: boolean;
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  oneTimeRows: OneTimeRow[];
  moneyInRows: MoneyInRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  monthlyRecurringUsd: number;
  roiRows: RoiRow[];
  blendedExpensesRoiPct: number | null;
}) {
  const statusLine = mercuryConnected
    ? "Auto-matched from Mercury · last sync just now"
    : "Mercury not connected";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="font-serif text-xl font-extrabold tracking-tight text-court-fg sm:text-2xl">
          Expenses
        </h3>
        <p
          className={
            "text-xs " +
            (mercuryConnected
              ? "text-court-fg-muted"
              : "text-court-fg-dim")
          }
        >
          {statusLine}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SubscriptionsCard
          recurringMonthly={recurringMonthly}
          recurringAnnual={recurringAnnual}
          oneTimeRows={oneTimeRows}
          moneyInRows={moneyInRows}
          subscriptionsYtdUsd={subscriptionsYtdUsd}
          activeSubscriptionsCount={activeSubscriptionsCount}
          monthlyRecurringUsd={monthlyRecurringUsd}
        />
        <RoiCard
          rows={roiRows}
          blendedRoiPct={blendedExpensesRoiPct}
        />
      </div>
    </section>
  );
}

function SubscriptionsCard({
  recurringMonthly,
  recurringAnnual,
  oneTimeRows,
  moneyInRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  monthlyRecurringUsd,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  oneTimeRows: OneTimeRow[];
  moneyInRows: MoneyInRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  monthlyRecurringUsd: number;
}) {
  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Subscriptions &amp; tools
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Catalog of recurring and one-time spend, plus money in
        </p>
      </div>

      <SubscriptionsList
        recurringMonthly={recurringMonthly}
        recurringAnnual={recurringAnnual}
        oneTime={oneTimeRows}
        moneyIn={moneyInRows}
        monthlyRecurringUsd={monthlyRecurringUsd}
      />

      <div className="mt-4 flex items-center justify-between border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        <span>
          {activeSubscriptionsCount} active subscription
          {activeSubscriptionsCount === 1 ? "" : "s"}
        </span>
        <span className="text-sm font-semibold tabular-nums text-court-fg">
          YTD expenses {formatUsd(subscriptionsYtdUsd)}
        </span>
      </div>

      <div className="mt-3">
        <ExpenseAddForm />
      </div>
    </div>
  );
}

function RoiCard({
  rows,
  blendedRoiPct,
}: {
  rows: RoiRow[];
  blendedRoiPct: number | null;
}) {
  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          ROI per tool
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Spend vs revenue attributed to deals sourced through it
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock>
          ROI lands once a subscription is logged or Mercury matches a tool.
        </EmptyBlock>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-[1.6fr_1fr_1.2fr_0.9fr] gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted">
            <span>Tool</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Rev. Attr.</span>
            <span className="text-right">ROI</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {rows.map((r) => (
              <RoiRowItem key={r.key} row={r} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        <span>Attribution: first-touch from sourcing record</span>
        <span className="text-sm font-semibold tabular-nums text-court-fg">
          Blended {blendedRoiPct != null ? `${ROI_INT_FMT.format(Math.round(blendedRoiPct))}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function RoiRowItem({ row }: { row: RoiRow }) {
  const roiLabel =
    row.roiPct != null
      ? `${ROI_INT_FMT.format(Math.round(row.roiPct))}%`
      : "—";
  const initials = avatarFor(row.toolName);
  return (
    <li className="grid grid-cols-[1.6fr_1fr_1.2fr_0.9fr] items-center gap-2 px-1 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <span className="truncate font-medium text-court-fg">
          {row.toolName}
        </span>
      </div>
      <span className="text-right tabular-nums text-court-fg">
        {formatUsd(row.spendUsd)}
      </span>
      <span className="text-right tabular-nums text-court-fg">
        {row.revUsd > 0 ? formatUsd(row.revUsd) : "—"}
      </span>
      <span
        className={
          "text-right font-semibold tabular-nums " +
          (row.roiPct == null
            ? "text-court-fg-dim"
            : row.roiPct >= 0
              ? "text-court-fg"
              : "text-red-600")
        }
      >
        {roiLabel}
      </span>
    </li>
  );
}

type MarginsCardData = {
  grossLabel: string;
  contributionLabel: string;
  netLabel: string;
  revenueFormatted: string;
  expensesFormatted: string;
};

type QuarterPacingData = {
  eyebrow: string;
  revenueFormatted: string;
  goalFormatted: string;
  pctToGoal: number;
  pctToGoalLabel: string;
  dayOfQuarter: number;
  daysInQuarter: number;
  pctOfQuarterLabel: string;
  toGoFormatted: string;
  pacingLabel: string;
};

type AnnualPacingData = {
  eyebrow: string;
  revenueFormatted: string;
  goalFormatted: string;
  pctToGoal: number;
  pctToGoalLabel: string;
  dayOfYear: number;
  daysInYear: number;
  pctOfYearLabel: string;
  toGoFormatted: string;
  forecastFormatted: string;
};

type GoalPacingCardData = {
  quarter: QuarterPacingData;
  annual: AnnualPacingData;
  avgFeeFormatted: string;
  placementsYtd: number;
};

function ProfitabilitySection({
  margins,
  goalPacing,
}: {
  margins: MarginsCardData;
  goalPacing: GoalPacingCardData;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="font-serif text-xl font-extrabold tracking-tight text-court-fg sm:text-2xl">
          Profitability
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MarginsCard data={margins} />
        <GoalPacingCard data={goalPacing} />
      </div>
    </section>
  );
}

function MarginsCard({ data }: { data: MarginsCardData }) {
  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Margins
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Three layers, same revenue base
        </p>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-court-border-soft">
        <MarginRow
          label="Gross margin"
          value={data.grossLabel}
          subline={`Revenue ${data.revenueFormatted} − COGS (tools, job boards) ${data.expensesFormatted}`}
        />
        <MarginRow
          label="Contribution margin"
          value={data.contributionLabel}
          subline="After variable costs per placement"
        />
        <MarginRow
          label="Net margin"
          value={data.netLabel}
          subline="After ops, software, owner draw allocation"
        />
      </ul>

      <p className="mt-3 text-xs text-court-fg-dim">
        Variable and ops estimates are placeholders until Mercury provides full
        transaction categorization
      </p>
    </div>
  );
}

function MarginRow({
  label,
  value,
  subline,
}: {
  label: string;
  value: string;
  subline: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
          {label}
        </p>
        <p className="mt-1 text-xs text-court-fg-muted">{subline}</p>
      </div>
      <p className="shrink-0 font-serif text-[28px] font-semibold leading-none tabular-nums text-court-fg">
        {value}
      </p>
    </li>
  );
}

function GoalPacingCard({ data }: { data: GoalPacingCardData }) {
  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Goal pacing
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Where the desk sits vs plan
        </p>
      </div>

      <PacingBlock
        eyebrow={data.quarter.eyebrow}
        revenueFormatted={data.quarter.revenueFormatted}
        goalFormatted={data.quarter.goalFormatted}
        pctToGoal={data.quarter.pctToGoal}
        pctToGoalLabel={data.quarter.pctToGoalLabel}
        leftFooter={`Day ${data.quarter.dayOfQuarter} of ${data.quarter.daysInQuarter} (${data.quarter.pctOfQuarterLabel} of quarter)`}
        rightFooter={`${data.quarter.toGoFormatted} to go · pacing ${data.quarter.pacingLabel}`}
        className="mt-4"
      />

      <div className="my-4 h-px bg-court-border-soft" />

      <PacingBlock
        eyebrow={data.annual.eyebrow}
        revenueFormatted={data.annual.revenueFormatted}
        goalFormatted={data.annual.goalFormatted}
        pctToGoal={data.annual.pctToGoal}
        pctToGoalLabel={data.annual.pctToGoalLabel}
        leftFooter={`Day ${data.annual.dayOfYear} of ${data.annual.daysInYear} (${data.annual.pctOfYearLabel} of year)`}
        rightFooter={`${data.annual.toGoFormatted} to clear · forecast ${data.annual.forecastFormatted} EOY`}
      />

      <p className="mt-4 border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        Avg fee {data.avgFeeFormatted} · {data.placementsYtd} placement
        {data.placementsYtd === 1 ? "" : "s"} YTD
      </p>
    </div>
  );
}

function PacingBlock({
  eyebrow,
  revenueFormatted,
  goalFormatted,
  pctToGoal,
  pctToGoalLabel,
  leftFooter,
  rightFooter,
  className,
}: {
  eyebrow: string;
  revenueFormatted: string;
  goalFormatted: string;
  pctToGoal: number;
  pctToGoalLabel: string;
  leftFooter: string;
  rightFooter: string;
  className?: string;
}) {
  const barWidth = Math.max(0, Math.min(100, pctToGoal));
  return (
    <div className={className}>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-court-fg-muted">
        {eyebrow}
      </p>
      <p className="mt-2 font-serif text-[26px] font-semibold leading-none tabular-nums text-court-fg">
        {revenueFormatted}
      </p>
      <p className="mt-1 text-xs text-court-fg-muted">
        of {goalFormatted} · {pctToGoalLabel} to goal
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-court-surface-subtle">
        <div
          className="h-full rounded-full bg-court-brand"
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-court-fg-muted">
        <span>{leftFooter}</span>
        <span className="text-right">{rightFooter}</span>
      </div>
    </div>
  );
}

