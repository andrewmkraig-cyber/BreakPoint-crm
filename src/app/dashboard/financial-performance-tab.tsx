import { ExpenseAddForm } from "@/app/dashboard/expense-add-form";
import { KpiTile } from "@/app/dashboard/kpi-tile";
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
import {
  dashboardPeriodRange,
  type DashboardPeriod,
} from "@/app/dashboard/period-tabs-shared";
import { buildPnlData, PnlCard, type PnlData } from "@/app/dashboard/pnl-card";
import { QUARTERLY_REVENUE_GOAL_USD } from "@/app/dashboard/goal-pacing";

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

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Net margin stays at 0% until Mercury (bank feed) wires in operating
// expenses beyond software tools — payroll, contractor pay, overhead.
// Until then we don't have the inputs to compute it honestly.
const NET_MARGIN_PLACEHOLDER_PCT = 0;

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
  period = "THIS_QUARTER",
}: {
  mode?: FinancialPerformanceMode;
  period?: DashboardPeriod;
} = {}) {
  const org = await getCurrentOrg();
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  // Revenue & Profitability section honors the selected period. The
  // Expenses tab stays calendar-year scoped because it has its own
  // structure (catalog rows + YTD aggregates) and no period selector.
  const range = mode === "expenses"
    ? { start: yearStart, endExclusive: yearEnd, label: `YTD ${year}` }
    : dashboardPeriodRange(period, now);
  const revStart = range.start;
  const revEnd = range.endExclusive;

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

  // One-shot cleanup: an early seed double-recorded the Lone Wolf
  // training fee under both "Lone Wolf Course" and "Training Course".
  // Idempotent deleteMany — does nothing once the duplicate row is
  // gone, so it's safe to leave inline.
  await prisma.toolExpense.deleteMany({
    where: {
      organizationId: org.id,
      name: { contains: "Training Course", mode: "insensitive" },
    },
  });
  // Apollo lives in the annual catalog with its own fallback. Any
  // manual Apollo ToolExpense row is now a duplicate of the catalog
  // entry — strip it so Recurring Annual shows exactly one Apollo row.
  await prisma.toolExpense.deleteMany({
    where: {
      organizationId: org.id,
      name: { contains: "apollo", mode: "insensitive" },
    },
  });

  const [
    revenueInvoices,
    placementsYtd,
    placementsHiredYtd,
    mercuryApiKey,
    mercuryTxnsAll,
    manualExpenses,
    paidInvoicesYtd,
    uninvoicedPlacementsPeriod,
    uninvoicedPlacementsYtd,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: { in: ["SENT", "PAID"] },
        OR: [
          { sentAt: { gte: revStart, lt: revEnd } },
          { paidAt: { gte: revStart, lt: revEnd } },
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
        placedAt: { gte: revStart, lt: revEnd },
      },
      select: { clientId: true, candidateSource: true },
    }),
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: "hired",
        // Money In list under the Expenses card stays calendar-year so
        // the "Money In · YTD" reading isn't surprised by a quarter cut.
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
    // YTD paid invoices feed the P&L card's placement-fee line. Always
    // calendar-year regardless of the selected period filter.
    prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: "PAID",
        paidAt: { gte: yearStart, lt: yearEnd },
      },
      select: { feeAmount: true },
    }),
    // Uninvoiced placements (locked fee, no invoice yet) folded into the
    // same revenue aggregations as invoiced placements. Mirrors the
    // Clubhouse Billing Tower's "earned this period" semantic — a
    // placement that's been recorded but not yet invoiced shouldn't
    // disappear from By Client / By Source / Trend just because the
    // invoice flow hasn't run. Outstanding/unpaid surfaces stay
    // invoice-only (handled on the Invoices tab, not here).
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { in: ["pending_start", "hired"] },
        feeTotal: { gt: 0 },
        invoices: { none: {} },
        placedAt: { gte: revStart, lt: revEnd },
      },
      select: {
        feeTotal: true,
        placedAt: true,
        clientId: true,
        client: { select: { name: true } },
        candidateSource: true,
      },
    }),
    // YTD uninvoiced bucket feeds the P&L card's Placement Fees line so
    // the YTD total matches the "earned" reading instead of "collected".
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        stage: { in: ["pending_start", "hired"] },
        feeTotal: { gt: 0 },
        invoices: { none: {} },
        placedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { feeTotal: true },
    }),
  ]);

  const uninvoicedRevenueUsd = uninvoicedPlacementsPeriod.reduce(
    (sum, p) => sum + (p.feeTotal ?? 0),
    0,
  );
  const revenueUsd =
    revenueInvoices.reduce((sum, r) => sum + decimalToNumber(r.feeAmount), 0) +
    uninvoicedRevenueUsd;

  // ---- Revenue section data ----

  const periodLabel = range.label;

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
  for (const p of uninvoicedPlacementsPeriod) {
    const id = p.clientId ?? "__unattached__";
    const name = p.client?.name ?? "Unattached";
    const existing = byClientMap.get(id) ?? {
      id,
      name,
      revenueUsd: 0,
      placements: id === "__unattached__" ? 0 : (placementsByClient.get(id) ?? 0),
    };
    existing.revenueUsd += p.feeTotal ?? 0;
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
  for (const p of uninvoicedPlacementsPeriod) {
    const src = p.candidateSource?.trim() || "Untagged";
    bySourceMap.set(src, (bySourceMap.get(src) ?? 0) + (p.feeTotal ?? 0));
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
  for (const p of uninvoicedPlacementsPeriod) {
    const refDate = p.placedAt;
    if (!refDate) continue;
    if (refDate.getFullYear() !== year) continue;
    const m = refDate.getMonth();
    if (m < qStartMonth || m >= qStartMonth + 3) continue;
    monthlyRevenue.set(
      m,
      (monthlyRevenue.get(m) ?? 0) + (p.feeTotal ?? 0),
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
    // What we show in the Cost column (e.g. annual-equivalent for GoDaddy).
    catalogCost: number;
    // The dollar amount Mercury actually charges. Defaults to catalogCost
    // when omitted. GoDaddy bills $46.59 every 3 years but we surface its
    // $15.53/yr annual equivalent, so its match window centers on $46.59.
    matchCost?: number;
    // Absolute min/max for the Mercury match window. When set, overrides
    // the default ±30% band — used for Anthropic Claude Code where
    // post-tax charges land in a $95–$115 corridor we want to catch
    // without widening the band for every other tool.
    matchMin?: number;
    matchMax?: number;
    // Optional muted line under the tool name (e.g. "billed every 3 years").
    subline?: string;
    // When Mercury never sees this tool (paid via personal card, etc.),
    // fall back to a stated YTD spend so the row doesn't sit at $0.
    fallbackPaidCount?: number;
    fallbackTotalUsd?: number;
  };
  const RECURRING_MONTHLY_CATALOG: RecurringCatalogEntry[] = [
    { displayName: "Pin", matcherName: "Pin", catalogCost: 299 },
    {
      displayName: "Anthropic / Claude Code",
      matcherName: "Anthropic / Claude",
      catalogCost: 100,
      matchMin: 95,
      matchMax: 115,
    },
    { displayName: "TheirStack", matcherName: "TheirStack", catalogCost: 58.95 },
    { displayName: "OpenPhone / Quo", matcherName: "OpenPhone / Quo", catalogCost: 35.64 },
    { displayName: "Vercel", matcherName: "Vercel", catalogCost: 21.6 },
    { displayName: "OpenAI / ChatGPT", matcherName: "OpenAI / ChatGPT", catalogCost: 20 },
  ];
  const RECURRING_ANNUAL_CATALOG: RecurringCatalogEntry[] = [
    {
      displayName: "Apollo",
      matcherName: "Apollo",
      catalogCost: 500,
      // Renewals land at $505.44 (subscription + tax). Explicit window
      // overrides the ±30% rule so post-tax amounts always hit the
      // annual bucket instead of falling through to one-time.
      matchMin: 400,
      matchMax: 700,
      fallbackPaidCount: 1,
      fallbackTotalUsd: 500,
    },
    { displayName: "Zoho", matcherName: "Zoho", catalogCost: 104 },
    {
      displayName: "DocuSign",
      matcherName: "DocuSign",
      catalogCost: 321.29,
      fallbackPaidCount: 1,
      fallbackTotalUsd: 321.29,
    },
  ];
  // Surfaced in its own "Every 3 Years" section below the annual list.
  const RECURRING_EVERY_3_YEARS_CATALOG: RecurringCatalogEntry[] = [
    {
      displayName: "GoDaddy",
      matcherName: "GoDaddy",
      catalogCost: 46.59,
      subline: "$15.53/yr equivalent",
    },
  ];

  // Anthropic txns that aren't the Claude subscription are pay-as-you-go
  // Console charges. Same matcher tool name, different display in the
  // one-time bucket.
  const ANTHROPIC_MATCHER_NAME = "Anthropic / Claude";
  const ANTHROPIC_CONSOLE_DISPLAY = "Anthropic Console";

  const RECURRING_TOLERANCE = 0.3;
  const matchesRecurringEntry = (amount: number, c: RecurringCatalogEntry) => {
    if (c.matchMin != null && c.matchMax != null) {
      return amount >= c.matchMin && amount <= c.matchMax;
    }
    const target = c.matchCost ?? c.catalogCost;
    return Math.abs(amount - target) / target <= RECURRING_TOLERANCE;
  };

  type RecurringAgg = { totalUsd: number; paidCount: number };
  const monthlyAgg = new Map<string, RecurringAgg>();
  const annualAgg = new Map<string, RecurringAgg>();
  const every3YearsAgg = new Map<string, RecurringAgg>();
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
      (c) => c.matcherName === tool && matchesRecurringEntry(spend, c),
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
      (c) => c.matcherName === tool && matchesRecurringEntry(spend, c),
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

    const every3YearsHit = RECURRING_EVERY_3_YEARS_CATALOG.find(
      (c) => c.matcherName === tool && matchesRecurringEntry(spend, c),
    );
    if (every3YearsHit) {
      const prev = every3YearsAgg.get(every3YearsHit.displayName) ?? {
        totalUsd: 0,
        paidCount: 0,
      };
      prev.totalUsd += spend;
      prev.paidCount += 1;
      every3YearsAgg.set(every3YearsHit.displayName, prev);
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
      matched: true,
    });
  }

  const recurringMonthly: RecurringRow[] = RECURRING_MONTHLY_CATALOG.map((c) => {
    const agg = monthlyAgg.get(c.displayName);
    const matched = !!agg && agg.paidCount > 0;
    return {
      key: `mo-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: matched ? agg!.totalUsd : (c.fallbackTotalUsd ?? 0),
      paidCount: matched ? agg!.paidCount : (c.fallbackPaidCount ?? 0),
      matched,
      subline: c.subline,
    };
  });
  const recurringAnnual: RecurringRow[] = RECURRING_ANNUAL_CATALOG.map((c) => {
    const agg = annualAgg.get(c.displayName);
    const matched = !!agg && agg.paidCount > 0;
    return {
      key: `yr-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: matched ? agg!.totalUsd : (c.fallbackTotalUsd ?? 0),
      paidCount: matched ? agg!.paidCount : (c.fallbackPaidCount ?? 0),
      matched,
      subline: c.subline,
    };
  });
  const recurringEvery3Years: RecurringRow[] = RECURRING_EVERY_3_YEARS_CATALOG.map((c) => {
    const agg = every3YearsAgg.get(c.displayName);
    const matched = !!agg && agg.paidCount > 0;
    return {
      key: `e3y-${c.displayName}`,
      toolName: c.displayName,
      catalogCost: c.catalogCost,
      totalYtdUsd: matched ? agg!.totalUsd : (c.fallbackTotalUsd ?? 0),
      paidCount: matched ? agg!.paidCount : (c.fallbackPaidCount ?? 0),
      matched,
      subline: c.subline,
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
        matched: false,
        subline: m.notes ?? undefined,
        toolExpenseId: m.id,
        startDate: m.startDate ?? null,
        notes: m.notes ?? undefined,
      });
    } else if (freq === "quarterly") {
      recurringMonthly.push({
        key: `manual-q-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost / 3,
        totalYtdUsd,
        paidCount,
        matched: false,
        subline: m.notes ?? undefined,
        toolExpenseId: m.id,
        startDate: m.startDate ?? null,
        notes: m.notes ?? undefined,
      });
    } else if (freq === "annual" || freq === "annually" || freq === "yearly") {
      recurringAnnual.push({
        key: `manual-yr-${m.id}`,
        toolName: m.name,
        catalogCost: m.cost,
        totalYtdUsd,
        paidCount,
        matched: false,
        subline: m.notes ?? undefined,
        toolExpenseId: m.id,
        startDate: m.startDate ?? null,
        notes: m.notes ?? undefined,
      });
    } else {
      // "One-time" and any other unrecognized frequency falls through
      // to the one-time list — best surface for a single charge.
      oneTimeRowsRaw.push({
        key: `manual-onetime-${m.id}`,
        toolName: m.name,
        amountUsd: totalYtdUsd,
        date: m.startDate ?? m.createdAt ?? null,
        matched: false,
        notes: m.notes ?? undefined,
        toolExpenseId: m.id,
      });
    }
  }

  // Hardcoded one-time manual entries (paid outside Mercury or pre-dating
  // the Mercury connection). Surface them alongside Mercury-matched rows
  // so the section is comprehensive.
  const HARDCODED_ONE_TIME: OneTimeRow[] = [
    {
      key: "manual-amazon-usbc",
      toolName: "Amazon",
      amountUsd: 7.33,
      date: new Date(2026, 2, 30),
      notes: "USBC to USB converter",
      matched: false,
    },
    {
      key: "manual-lone-wolf",
      toolName: "Lone Wolf Course",
      amountUsd: 1600,
      date: new Date(2026, 2, 16),
      notes: "biz dev expense",
      matched: false,
    },
    {
      key: "manual-llc-formation",
      toolName: "LLC Formation Filing",
      amountUsd: 99,
      date: new Date(2026, 2, 10),
      notes: "startup legal fee",
      matched: false,
    },
    {
      key: "manual-trade-name",
      toolName: "Trade Name Filing",
      amountUsd: 39,
      date: new Date(2026, 2, 18),
      notes: "startup legal fee",
      matched: false,
    },
    {
      key: "manual-claude-pro",
      toolName: "Claude Pro 1 month",
      amountUsd: 100,
      date: new Date(2026, 3, 1),
      notes: "1 month Claude Pro",
      matched: false,
    },
  ];
  oneTimeRowsRaw.push(...HARDCODED_ONE_TIME);

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
      source: name,
      amountUsd: p.feeTotal ?? 0,
      date: p.placedAt ?? null,
    };
  });
  const cashbackMoneyInRows: MoneyInRow[] = cashbackTxns.map((c) => ({
    key: c.key,
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
  const every3YearsRecurringSubtotal = recurringEvery3Years.reduce(
    (s, r) => s + r.totalYtdUsd,
    0,
  );
  const oneTimeSubtotal = oneTimeRows.reduce((s, r) => s + r.amountUsd, 0);
  // `subscriptionsYtdUsd` is the canonical YTD expense total. The
  // "YTD expenses" footer on the Subscriptions card AND the P&L's
  // "Total Expenses" row both render this exact number — so the four
  // section subtotals (monthly + annual + every-3-years + one-time)
  // must add up here and only here.
  const subscriptionsYtdUsd =
    monthlyRecurringSubtotal +
    annualRecurringSubtotal +
    every3YearsRecurringSubtotal +
    oneTimeSubtotal;

  // P&L card's Placement Fees line: PAID invoices YTD plus YTD
  // uninvoiced placements (locked fee, no invoice). Mirrors the "earned"
  // semantic the Clubhouse Billing Tower and the Total Revenue tile use
  // so all three reads agree.
  const placementFeesYtdUsd =
    paidInvoicesYtd.reduce((sum, r) => sum + decimalToNumber(r.feeAmount), 0) +
    uninvoicedPlacementsYtd.reduce((sum, p) => sum + (p.feeTotal ?? 0), 0);
  const pnlData: PnlData = buildPnlData({
    placementFeesUsd: placementFeesYtdUsd,
    recurringMonthlyUsd: monthlyRecurringSubtotal,
    recurringAnnualUsd: annualRecurringSubtotal,
    recurringEvery3YearsUsd: every3YearsRecurringSubtotal,
    oneTimeUsd: oneTimeSubtotal,
  });

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
  for (const r of recurringEvery3Years) {
    if (r.totalYtdUsd > 0) bump(r.toolName, r.totalYtdUsd);
  }
  for (const r of oneTimeRows) bump(r.toolName, r.amountUsd);

  // Whitelist for the ROI card — the desk only weights ROI on its
  // active sourcing channels. Other tools (Vercel, Anthropic, Zoho,
  // etc.) cost money but aren't tracked against revenue attribution.
  const ROI_WHITELIST_ARRAY = [
    "Pin",
    "Apollo",
    "TheirStack",
    "LinkedIn",
    "Indeed",
  ] as const;
  const ROI_WHITELIST = new Set<string>(ROI_WHITELIST_ARRAY);
  for (const name of ROI_WHITELIST_ARRAY) {
    if (!spendByDisplayName.has(name)) spendByDisplayName.set(name, 0);
  }

  const roiRows: RoiRow[] = Array.from(spendByDisplayName.entries())
    .filter(([toolName]) => ROI_WHITELIST.has(toolName))
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

  const marginsCardData: MarginsCardData = {
    grossLabel: fmtPct1(grossMarginProfPct),
    contributionLabel: fmtPct1(contributionMarginProfPct),
    netLabel: fmtPct1(netMarginProfPct),
    revenueFormatted: formatUsd(revenueUsd),
    expensesFormatted: formatUsd(expensesUsd),
  };

  const showRevenueProfitability =
    mode === "full" || mode === "revenue-profitability";
  const showExpenses = mode === "full" || mode === "expenses";

  const eyebrowLabel = showExpenses
    ? "SUBSCRIPTIONS, TOOLS & SPEND"
    : "REVENUE, MARGINS & PROFITABILITY";
  // Mercury status sits inline with the eyebrow on the Expenses tab so
  // the cards rise to the top of the column instead of being pushed
  // down by a dedicated status row. Mirrors the Clubhouse tab pattern
  // (eyebrow + period selector share one row).
  const mercuryStatusLine = mercuryConnected
    ? "Auto-matched from Mercury · last sync just now"
    : "Mercury not connected";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          {eyebrowLabel}
        </p>
        {showExpenses ? (
          <p
            className={
              "text-[11px] " +
              (mercuryConnected ? "text-court-fg-muted" : "text-court-fg-dim")
            }
          >
            {mercuryStatusLine}
          </p>
        ) : null}
      </div>
      {showRevenueProfitability && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Total Revenue" value={formatUsd(revenueUsd)} zeroDim />
          <KpiTile label="Gross Margin" value={grossMarginLabel} zeroDim />
          <KpiTile label="Net Margin" value={netMarginLabel} zeroDim />
          <KpiTile label="Total Expenses" value={formatUsd(expensesUsd)} zeroDim />
          <KpiTile label="Blended ROI" value={roiLabel} zeroDim />
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
          recurringMonthly={recurringMonthly}
          recurringAnnual={recurringAnnual}
          recurringEvery3Years={recurringEvery3Years}
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
        <ProfitabilitySection margins={marginsCardData} pnl={pnlData} />
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
    <div className="rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
        {title}
      </p>
      <p className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
        {subline}
      </p>
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
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-court-surface-subtle">
          <div
            className="h-full rounded-full bg-court-accent"
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
    <div className="rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Trend · {quarterLabel}
          </p>
          <p className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
            Monthly close-out
          </p>
          <p className="mt-0.5 text-[11px] text-court-fg-muted">
            vs {formatUsd(QUARTERLY_REVENUE_GOAL_USD)} quarterly goal
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums text-court-fg">
          {progressLabel}
        </div>
      </div>

      {maxMonthUsd === 0 ? (
        // Fallback: zero revenue across every month in the quarter would
        // otherwise render three flat 4%-tall bars stamped with $0 — the
        // chart reads as empty. Drop to a clean 3-column month + value
        // text layout instead so the panel still scans cleanly.
        <div className="mt-4 grid grid-cols-3 gap-3">
          {quarterMonths.map((m) => {
            const usd = monthlyRevenue.get(m) ?? 0;
            const isFuture = m > currentMonth;
            return (
              <div key={m} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-court-fg-muted">
                  {MONTH_FULL[m].slice(0, 3)}
                </span>
                <span className="text-[18px] font-semibold tabular-nums text-court-fg">
                  {isFuture || usd === 0 ? "—" : formatUsd(usd)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
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
      )}

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

// minmax(0, …) on the Tool column lets the avatar + label compress and
// truncate at narrow card widths (e.g. when the ROI card sits alongside
// Subscriptions at 1280px viewport, before the xl breakpoint stacks
// them). The numeric columns hold their minimum so dollar amounts never
// collide with the Tool name.
const ROI_GRID =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(70px,1fr)_minmax(80px,1.2fr)_minmax(56px,0.9fr)]";

function avatarFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned.slice(0, 2) || "??").toUpperCase();
}

function ExpensesSection({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
  oneTimeRows,
  moneyInRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  monthlyRecurringUsd,
  roiRows,
  blendedExpensesRoiPct,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
  oneTimeRows: OneTimeRow[];
  moneyInRows: MoneyInRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  monthlyRecurringUsd: number;
  roiRows: RoiRow[];
  blendedExpensesRoiPct: number | null;
}) {
  return (
    <section className="flex flex-col gap-5">
      <ExpenseAddForm />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SubscriptionsCard
          recurringMonthly={recurringMonthly}
          recurringAnnual={recurringAnnual}
          recurringEvery3Years={recurringEvery3Years}
          oneTimeRows={oneTimeRows}
          moneyInRows={moneyInRows}
          subscriptionsYtdUsd={subscriptionsYtdUsd}
          activeSubscriptionsCount={activeSubscriptionsCount}
          monthlyRecurringUsd={monthlyRecurringUsd}
        />
        <div className="flex flex-col gap-5">
          <MonthlyOperatingCostCard
            recurringMonthly={recurringMonthly}
            recurringAnnual={recurringAnnual}
            recurringEvery3Years={recurringEvery3Years}
          />
          <RoiCard
            rows={roiRows}
            blendedRoiPct={blendedExpensesRoiPct}
          />
        </div>
      </div>
    </section>
  );
}

function SubscriptionsCard({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
  oneTimeRows,
  moneyInRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  monthlyRecurringUsd,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
  oneTimeRows: OneTimeRow[];
  moneyInRows: MoneyInRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  monthlyRecurringUsd: number;
}) {
  const moneyInTotal = moneyInRows.reduce((s, r) => s + r.amountUsd, 0);
  const netProfit = moneyInTotal - subscriptionsYtdUsd;
  const netProfitPositive = netProfit >= 0;
  const marginPctLabel =
    moneyInTotal > 0
      ? `${((netProfit / moneyInTotal) * 100).toFixed(1)}% margin`
      : "— margin";

  return (
    <div className="flex flex-col rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          Subscriptions &amp; Tools
        </p>
        <p className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
          Catalog of recurring and one-time spend
        </p>
        <p className="mt-0.5 text-[11px] text-court-fg-muted">
          Plus money in to balance the ledger
        </p>
      </div>

      <SubscriptionsList
        recurringMonthly={recurringMonthly}
        recurringAnnual={recurringAnnual}
        recurringEvery3Years={recurringEvery3Years}
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

      <div className="mt-2 flex items-center justify-between border-t border-court-border-soft pt-3 text-sm">
        <span className="font-semibold text-court-fg">Net Profit / Loss</span>
        <span className="flex items-baseline gap-2">
          <span
            className={
              "font-bold tabular-nums " +
              (netProfitPositive ? "text-court-brand" : "text-red-600")
            }
          >
            {formatUsd(netProfit)}
          </span>
          <span className="text-xs text-court-fg-muted">
            ({marginPctLabel})
          </span>
        </span>
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
    <div className="flex flex-col rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          ROI per Tool
        </p>
        <p className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
          Spend vs revenue attributed
        </p>
        <p className="mt-0.5 text-[11px] text-court-fg-muted">
          To deals sourced through each tool
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock>
          ROI lands once a subscription is logged or Mercury matches a tool.
        </EmptyBlock>
      ) : (
        <div className="mt-4">
          <div className={`${ROI_GRID} gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted`}>
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
  const hasRoi = row.roiPct != null;
  const roiLabel = hasRoi
    ? `${ROI_INT_FMT.format(Math.round(row.roiPct!))}%`
    : "—";
  const initials = avatarFor(row.toolName);
  const roiChipCls = !hasRoi
    ? "text-court-border"
    : row.roiPct! >= 0
      ? "bg-court-accent-tint text-court-brand-dark"
      : "bg-red-50 text-red-500";
  return (
    <li className={`${ROI_GRID} items-center gap-2 px-1 py-2.5 text-[13px]`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-court-surface-subtle text-[10px] font-bold text-court-brand-dark">
          {initials}
        </span>
        <span
          className="min-w-0 truncate text-[13px] font-medium text-court-fg"
          title={row.toolName}
        >
          {row.toolName}
        </span>
      </div>
      <span className="text-right font-mono text-[12px] tabular-nums text-court-fg">
        {row.spendUsd > 0 ? formatUsd(row.spendUsd) : <span className="text-court-border">—</span>}
      </span>
      <span className="text-right font-mono text-[12px] tabular-nums text-court-fg">
        {row.revUsd > 0 ? formatUsd(row.revUsd) : <span className="text-court-border">—</span>}
      </span>
      {hasRoi ? (
        <span className="flex justify-end">
          <span
            className={`inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-semibold tabular-nums ${roiChipCls}`}
          >
            {roiLabel}
          </span>
        </span>
      ) : (
        <span className="text-right text-[12px] tabular-nums text-court-border">—</span>
      )}
    </li>
  );
}

// Monthly Operating Cost answers: "what does it cost to keep the lights
// on each month?". Every recurring subscription is normalized to a
// monthly equivalent — annual / 12, every-3-years / 36 — so the desk
// can see the true monthly burn at a glance. One-time charges are
// excluded by construction (they're not operating costs).
const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatUsdCents(n: number): string {
  return USD_CENTS.format(n);
}

type OperatingCostRow = {
  key: string;
  toolName: string;
  monthlyEquivUsd: number;
};

function buildOperatingCostRows(
  recurringMonthly: RecurringRow[],
  recurringAnnual: RecurringRow[],
  recurringEvery3Years: RecurringRow[],
): OperatingCostRow[] {
  const rows: OperatingCostRow[] = [];
  for (const r of recurringMonthly) {
    rows.push({
      key: `op-${r.key}`,
      toolName: r.toolName,
      monthlyEquivUsd: r.catalogCost,
    });
  }
  for (const r of recurringAnnual) {
    rows.push({
      key: `op-${r.key}`,
      toolName: r.toolName,
      monthlyEquivUsd: r.catalogCost / 12,
    });
  }
  for (const r of recurringEvery3Years) {
    rows.push({
      key: `op-${r.key}`,
      toolName: r.toolName,
      monthlyEquivUsd: r.catalogCost / 36,
    });
  }
  return rows.sort((a, b) => b.monthlyEquivUsd - a.monthlyEquivUsd);
}

const OPERATING_COST_GRID =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(120px,1fr)]";

function MonthlyOperatingCostCard({
  recurringMonthly,
  recurringAnnual,
  recurringEvery3Years,
}: {
  recurringMonthly: RecurringRow[];
  recurringAnnual: RecurringRow[];
  recurringEvery3Years: RecurringRow[];
}) {
  const rows = buildOperatingCostRows(
    recurringMonthly,
    recurringAnnual,
    recurringEvery3Years,
  );
  const totalMonthlyRunRate = rows.reduce(
    (s, r) => s + r.monthlyEquivUsd,
    0,
  );

  return (
    <div className="flex flex-col rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
          Monthly Operating Cost
        </p>
        <p className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
          Keeping the lights on
        </p>
      </div>

      {/* Spec rule 3: Total Run Rate panel — bordered tile sized
          to read as the primary takeaway in the card. */}
      <div className="mb-4 mt-4 rounded-xl border border-court-accent/30 bg-court-surface-subtle p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Total Monthly Run Rate
        </p>
        <p className="mt-1 font-serif text-[24px] font-extrabold leading-none tabular-nums text-court-fg">
          {formatUsdCents(totalMonthlyRunRate)}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock>
          No recurring subscriptions logged yet — monthly run rate will land here once tools are tracked.
        </EmptyBlock>
      ) : (
        <ul className="divide-y divide-court-border-soft">
          {rows.map((r) => (
            <li
              key={r.key}
              className={`${OPERATING_COST_GRID} items-center gap-2 py-2.5`}
            >
              <span
                className="min-w-0 truncate text-[13px] text-court-fg"
                title={r.toolName}
              >
                {r.toolName}
              </span>
              <span className="text-right font-mono text-[12px] tabular-nums text-court-fg">
                {formatUsdCents(r.monthlyEquivUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type MarginsCardData = {
  grossLabel: string;
  contributionLabel: string;
  netLabel: string;
  revenueFormatted: string;
  expensesFormatted: string;
};

function ProfitabilitySection({
  margins,
  pnl,
}: {
  margins: MarginsCardData;
  pnl: PnlData;
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
        <PnlCard data={pnl} />
      </div>
    </section>
  );
}

function MarginsCard({ data }: { data: MarginsCardData }) {
  return (
    <div className="flex flex-col rounded-2xl border-0 bg-court-surface p-5 shadow-sm">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Margins
        </p>
        <p className="font-serif text-[18px] font-bold tracking-tight text-court-fg">
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

