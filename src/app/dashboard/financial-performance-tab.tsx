import {
  CircleDollarSign,
  PercentCircle,
  Scale,
  Sparkles,
  Wallet,
} from "lucide-react";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { SectionHero } from "@/components/section-hero";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

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

  const [revenueInvoices, toolExpenses, placementsYtd] = await Promise.all([
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
      select: { cost: true, paidCount: true },
    }),
    prisma.placement.findMany({
      where: {
        organizationId: org.id,
        placedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { clientId: true, candidateSource: true },
    }),
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

  return (
    <div className="flex flex-col gap-8">
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
    </div>
  );
}

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
