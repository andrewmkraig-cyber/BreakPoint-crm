import {
  CircleDollarSign,
  PercentCircle,
  Scale,
  Sparkles,
  Wallet,
} from "lucide-react";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { ExpenseAddForm } from "@/app/dashboard/expense-add-form";
import { SectionHero } from "@/components/section-hero";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getMercuryTransactions,
  mercuryTransactionDescription,
} from "@/lib/mercury";
import { matchTransaction } from "@/lib/mercury-matcher";

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

export async function FinancialPerformanceTab() {
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
    toolExpenses,
    placementsYtd,
    mercuryApiKey,
    mercuryTxnsAll,
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
    prisma.toolExpense.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        name: true,
        cost: true,
        frequency: true,
        paidCount: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        placedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { clientId: true, candidateSource: true },
    }),
    mercuryKeyPromise,
    mercuryTxnsPromise,
  ]);

  // KPI strip math (unchanged).
  const revenueUsd = revenueInvoices.reduce(
    (sum, r) => sum + decimalToNumber(r.feeAmount),
    0,
  );
  const expensesUsd = toolExpenses.reduce(
    (sum, t) => sum + t.cost * t.paidCount,
    0,
  );
  const grossMarginPct =
    revenueUsd > 0 ? ((revenueUsd - expensesUsd) / revenueUsd) * 100 : null;
  const blendedRoiPct =
    expensesUsd > 0 ? ((revenueUsd - expensesUsd) / expensesUsd) * 100 : null;

  const grossMarginLabel =
    grossMarginPct != null ? `${grossMarginPct.toFixed(1)}%` : "—";
  const netMarginLabel = `${NET_MARGIN_PLACEHOLDER_PCT.toFixed(1)}%`;
  const roiLabel =
    blendedRoiPct != null ? `${Math.round(blendedRoiPct)}%` : "—";

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
  // Mercury debits arrive as negative numbers; negating turns them into
  // positive spend. Credits (refunds) shrink the figure honestly. We
  // bucket by `matchTransaction()` — anything it can't classify is
  // ignored here and remains visible to the recruiter in the connector
  // panel rather than guessed into a tool.
  const mercuryConnected = mercuryApiKey != null;
  const mercuryTxns = mercuryTxnsAll.filter((t) => {
    const stamp = t.postedAt ?? t.createdAt;
    if (!stamp) return false;
    return new Date(stamp).getFullYear() === year;
  });

  // Diagnostic: surface the first 5 raw Mercury transaction descriptions
  // to Vercel logs so we can tune mercury-matcher keywords against the
  // actual upstream strings (bankDescription vs counterpartyName, casing,
  // suffixes like "Inc", etc.).
  if (mercuryConnected) {
    const sample = mercuryTxns.slice(0, 5).map((t) => ({
      bankDescription: t.bankDescription ?? null,
      counterpartyName: t.counterpartyName ?? null,
      resolved: mercuryTransactionDescription(t),
      matched: matchTransaction(mercuryTransactionDescription(t)),
    }));
    console.log(
      `[financial-performance] Mercury sample (${mercuryTxns.length} YTD of ${mercuryTxnsAll.length} fetched):`,
      JSON.stringify(sample, null, 2),
    );
  } else {
    console.log(`[financial-performance] Mercury not connected for org ${org.id}`);
  }

  const mercuryByTool = new Map<string, { count: number; totalUsd: number }>();
  for (const t of mercuryTxns) {
    const description = mercuryTransactionDescription(t);
    if (!description) continue;
    const tool = matchTransaction(description);
    if (!tool) continue;
    const raw = Number(t.amount ?? 0);
    if (!Number.isFinite(raw)) continue;
    const signedSpend = -raw;
    const prev = mercuryByTool.get(tool) ?? { count: 0, totalUsd: 0 };
    prev.count += 1;
    prev.totalUsd += signedSpend;
    mercuryByTool.set(tool, prev);
  }

  const subscriptionRows: SubscriptionRow[] = [];
  const consumedExpenseIds = new Set<string>();
  Array.from(mercuryByTool.entries()).forEach(([tool, agg]) => {
    const te = toolExpenses.find(
      (t) => t.name.toLowerCase() === tool.toLowerCase(),
    );
    if (te) consumedExpenseIds.add(te.id);
    subscriptionRows.push({
      key: `merc-${tool}`,
      toolName: te?.name ?? tool,
      cost: te?.cost ?? null,
      frequency: te?.frequency ?? null,
      paidCount: te?.paidCount ?? agg.count,
      totalYtdUsd: agg.totalUsd,
      status: "Mercury matched",
    });
  });
  for (const te of toolExpenses) {
    if (consumedExpenseIds.has(te.id)) continue;
    subscriptionRows.push({
      key: `te-${te.id}`,
      toolName: te.name,
      cost: te.cost,
      frequency: te.frequency,
      paidCount: te.paidCount,
      totalYtdUsd: te.cost * te.paidCount,
      status: "Manual",
    });
  }
  subscriptionRows.sort((a, b) => b.totalYtdUsd - a.totalYtdUsd);

  const subscriptionsYtdUsd = subscriptionRows.reduce(
    (sum, r) => sum + r.totalYtdUsd,
    0,
  );
  const activeSubscriptionsCount = subscriptionRows.length;

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

  const roiRows: RoiRow[] = subscriptionRows.map((r) => {
    const rev = revByLowerSource.get(r.toolName.toLowerCase()) ?? 0;
    const roiPct =
      r.totalYtdUsd > 0 && rev > 0
        ? ((rev - r.totalYtdUsd) / r.totalYtdUsd) * 100
        : null;
    return {
      key: r.key,
      toolName: r.toolName,
      spendUsd: r.totalYtdUsd,
      revUsd: rev,
      roiPct,
    };
  });

  const totalRoiSpend = roiRows.reduce((s, r) => s + r.spendUsd, 0);
  const totalRoiRev = roiRows.reduce((s, r) => s + r.revUsd, 0);
  const blendedExpensesRoiPct =
    totalRoiSpend > 0
      ? ((totalRoiRev - totalRoiSpend) / totalRoiSpend) * 100
      : null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHero
        eyebrow="FINANCIAL PERFORMANCE"
        title="Revenue, margins, and ROI."
        description="Year-to-date revenue from sent and paid invoices, measured against desk expenses and performance."
      />

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

      <ExpensesSection
        mercuryConnected={mercuryConnected}
        subscriptionRows={subscriptionRows}
        subscriptionsYtdUsd={subscriptionsYtdUsd}
        activeSubscriptionsCount={activeSubscriptionsCount}
        roiRows={roiRows}
        blendedExpensesRoiPct={blendedExpensesRoiPct}
      />
    </div>
  );
}

type SubscriptionRow = {
  key: string;
  toolName: string;
  cost: number | null;
  frequency: string | null;
  paidCount: number;
  totalYtdUsd: number;
  status: "Mercury matched" | "Manual";
};

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
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
            Revenue
          </p>
          <h3 className="mt-1 font-serif text-xl font-extrabold tracking-tight text-court-fg sm:text-2xl">
            Where it&apos;s coming from.
          </h3>
        </div>
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
  subscriptionRows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
  roiRows,
  blendedExpensesRoiPct,
}: {
  mercuryConnected: boolean;
  subscriptionRows: SubscriptionRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
  roiRows: RoiRow[];
  blendedExpensesRoiPct: number | null;
}) {
  const statusLine = mercuryConnected
    ? "Auto-matched from Mercury · last sync just now"
    : "Mercury not connected";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-court-fg-muted">
            Expenses
          </p>
          <h3 className="mt-1 font-serif text-xl font-extrabold tracking-tight text-court-fg sm:text-2xl">
            Tools, fees, and where it goes.
          </h3>
        </div>
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
          rows={subscriptionRows}
          subscriptionsYtdUsd={subscriptionsYtdUsd}
          activeSubscriptionsCount={activeSubscriptionsCount}
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
  rows,
  subscriptionsYtdUsd,
  activeSubscriptionsCount,
}: {
  rows: SubscriptionRow[];
  subscriptionsYtdUsd: number;
  activeSubscriptionsCount: number;
}) {
  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Subscriptions &amp; tools
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Recurring spend pulled from Mercury transactions
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyBlock>
          No subscription spend logged yet. Add one below or connect Mercury to
          auto-match transactions.
        </EmptyBlock>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-[1.6fr_0.7fr_0.9fr_0.5fr_0.9fr_1.1fr] gap-2 px-1 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-court-fg-muted">
            <span>Tool</span>
            <span className="text-right">Cost</span>
            <span>Frequency</span>
            <span className="text-right">Paid</span>
            <span className="text-right">Total YTD</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-court-border-soft">
            {rows.map((r) => (
              <SubscriptionRowItem key={r.key} row={r} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-court-border-soft pt-3 text-xs text-court-fg-muted">
        <span>
          {activeSubscriptionsCount} active subscription
          {activeSubscriptionsCount === 1 ? "" : "s"}
        </span>
        <span className="text-sm font-semibold tabular-nums text-court-fg">
          YTD subtotal {formatUsd(subscriptionsYtdUsd)}
        </span>
      </div>

      <div className="mt-3">
        <ExpenseAddForm />
      </div>
    </div>
  );
}

function SubscriptionRowItem({ row }: { row: SubscriptionRow }) {
  const initials = avatarFor(row.toolName);
  return (
    <li className="grid grid-cols-[1.6fr_0.7fr_0.9fr_0.5fr_0.9fr_1.1fr] items-center gap-2 px-1 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-xs font-bold text-court-fg-muted">
          {initials}
        </span>
        <span className="truncate font-medium text-court-fg">
          {row.toolName}
        </span>
      </div>
      <span className="text-right tabular-nums text-court-fg">
        {row.cost != null ? formatUsd(row.cost) : "—"}
      </span>
      <span>
        {row.frequency ? (
          <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
            {row.frequency}
          </span>
        ) : (
          <span className="text-xs text-court-fg-dim">—</span>
        )}
      </span>
      <span className="text-right tabular-nums text-court-fg">
        {row.paidCount}
      </span>
      <span className="text-right font-semibold tabular-nums text-court-fg">
        {formatUsd(row.totalYtdUsd)}
      </span>
      <span className="flex justify-end">
        <StatusChip status={row.status} />
      </span>
    </li>
  );
}

function StatusChip({
  status,
}: {
  status: "Mercury matched" | "Manual";
}) {
  if (status === "Mercury matched") {
    return (
      <span className="inline-flex items-center rounded-full bg-court-brand-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-brand-dark">
        Mercury matched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
      Manual
    </span>
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
