import type React from "react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  DEFAULT_TIME_RANGE,
  timeRange,
  type TimeRangeSelection,
} from "@/lib/time-range";
import { QUARTERLY_REVENUE_GOAL_USD } from "@/app/dashboard/goal-pacing";

// The three Revenue cards (By client / Average deal size / Trend) lifted out of
// the deleted "Revenue & Profitability" Finances tab and mounted above
// the Placements map. Honors the same period selection the Placements tab uses.

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

function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
}

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ClientRow = {
  id: string;
  name: string;
  revenueUsd: number;
  placements: number;
};
type DealSizeRow = {
  id: string;
  name: string;
  detail: string;
  revenueUsd: number;
};

export async function RevenueCards({
  selection = DEFAULT_TIME_RANGE,
}: {
  selection?: TimeRangeSelection;
} = {}) {
  const org = await getCurrentOrg();
  const now = new Date();
  const year = now.getFullYear();
  const range = timeRange(selection, now);
  const revStart = range.start;
  const revEnd = range.endExclusive;

  // Current calendar quarter bounds — for the Trend card. Months are
  // 0-indexed (April = 3, June = 5), so qStartMonth jumps in steps of 3.
  const currentMonth = now.getMonth();
  const currentQuarterIndex = Math.floor(currentMonth / 3);
  const qStartMonth = currentQuarterIndex * 3;
  const qStart = new Date(year, qStartMonth, 1);
  const qEnd = new Date(year, qStartMonth + 3, 1);

  const [revenueInvoices, placementsYtd, uninvoicedPlacementsPeriod] =
    await Promise.all([
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
          id: true,
          invoiceNumber: true,
          placementId: true,
          roleTitle: true,
          clientId: true,
          client: { select: { name: true } },
          candidate: { select: { firstName: true, lastName: true } },
          placement: {
            select: {
              candidate: { select: { firstName: true, lastName: true } },
              job: { select: { title: true } },
              offerTitle: true,
            },
          },
        },
      }),
      prisma.placement.findMany({
        where: {
          organizationId: org.id,
          placedAt: { gte: revStart, lt: revEnd },
        },
        select: { clientId: true },
      }),
      // Uninvoiced placements (locked fee, no invoice yet) folded into the
      // same revenue aggregations as invoiced placements, mirroring the
      // Clubhouse Billing Tower's "earned this period" semantic.
      prisma.placement.findMany({
        where: {
          organizationId: org.id,
          stage: { in: ["pending_start", "hired"] },
          feeTotal: { gt: 0 },
          invoices: { none: {} },
          placedAt: { gte: revStart, lt: revEnd },
        },
        select: {
          id: true,
          feeTotal: true,
          placedAt: true,
          clientId: true,
          client: { select: { name: true } },
          candidate: { select: { firstName: true, lastName: true } },
          job: { select: { title: true } },
          offerTitle: true,
        },
      }),
    ]);

  const periodLabel = range.label;

  // Placement counts per client.
  const placementsByClient = new Map<string, number>();
  for (const p of placementsYtd) {
    if (p.clientId) {
      placementsByClient.set(
        p.clientId,
        (placementsByClient.get(p.clientId) ?? 0) + 1,
      );
    }
  }
  const totalPlacementsYtd = placementsYtd.length;

  // By Client: aggregate invoice revenue per client.
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
  const byClientOthersUsd = byClientOthers.reduce((s, r) => s + r.revenueUsd, 0);
  const byClientMaxUsd = byClientTop[0]?.revenueUsd ?? 0;

  // Average deal size: one row per placement/deal, sorted largest to smallest.
  const dealSizeMap = new Map<string, DealSizeRow>();
  function addDealSizeRow(row: DealSizeRow) {
    const existing = dealSizeMap.get(row.id);
    if (existing) {
      existing.revenueUsd += row.revenueUsd;
      return;
    }
    dealSizeMap.set(row.id, row);
  }
  for (const inv of revenueInvoices) {
    const candidateName = joinName(
      inv.candidate?.firstName ?? inv.placement?.candidate?.firstName,
      inv.candidate?.lastName ?? inv.placement?.candidate?.lastName,
    );
    const clientName = inv.client?.name ?? "Unattached";
    const roleTitle =
      inv.roleTitle?.trim() ||
      inv.placement?.offerTitle?.trim() ||
      inv.placement?.job?.title?.trim() ||
      "";
    addDealSizeRow({
      id: inv.placementId ? `placement:${inv.placementId}` : `invoice:${inv.id}`,
      name: candidateName || clientName || inv.invoiceNumber,
      detail: [clientName, roleTitle].filter(Boolean).join(" · "),
      revenueUsd: decimalToNumber(inv.feeAmount),
    });
  }
  for (const p of uninvoicedPlacementsPeriod) {
    const candidateName = joinName(p.candidate?.firstName, p.candidate?.lastName);
    const clientName = p.client?.name ?? "Unattached";
    const roleTitle = p.offerTitle?.trim() || p.job?.title?.trim() || "";
    addDealSizeRow({
      id: `placement:${p.id}`,
      name: candidateName || clientName,
      detail: [clientName, roleTitle].filter(Boolean).join(" · "),
      revenueUsd: p.feeTotal ?? 0,
    });
  }
  const dealSizeRows = Array.from(dealSizeMap.values())
    .filter((r) => r.revenueUsd > 0)
    .sort((a, b) => b.revenueUsd - a.revenueUsd);
  const dealSizeTotalUsd = dealSizeRows.reduce((s, r) => s + r.revenueUsd, 0);
  const averageDealUsd =
    dealSizeRows.length > 0 ? dealSizeTotalUsd / dealSizeRows.length : 0;
  const dealSizeTop = dealSizeRows.slice(0, 6);
  const dealSizeMaxUsd = dealSizeTop[0]?.revenueUsd ?? 0;

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
    monthlyRevenue.set(m, (monthlyRevenue.get(m) ?? 0) + decimalToNumber(inv.feeAmount));
  }
  for (const p of uninvoicedPlacementsPeriod) {
    const refDate = p.placedAt;
    if (!refDate) continue;
    if (refDate.getFullYear() !== year) continue;
    const m = refDate.getMonth();
    if (m < qStartMonth || m >= qStartMonth + 3) continue;
    monthlyRevenue.set(m, (monthlyRevenue.get(m) ?? 0) + (p.feeTotal ?? 0));
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
          othersCount={byClientOthers.length}
          othersUsd={byClientOthersUsd}
          totalUsd={byClientTotalUsd}
          maxUsd={byClientMaxUsd}
          totalPlacementsYtd={totalPlacementsYtd}
        />
        <AverageDealSizeCard
          rows={dealSizeTop}
          averageDealUsd={averageDealUsd}
          totalDeals={dealSizeRows.length}
          maxUsd={dealSizeMaxUsd}
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

function AverageDealSizeCard({
  rows,
  averageDealUsd,
  totalDeals,
  maxUsd,
}: {
  rows: DealSizeRow[];
  averageDealUsd: number;
  totalDeals: number;
  maxUsd: number;
}) {
  return (
    <Panel
      title="Average deal size"
      subline={`${formatUsd(averageDealUsd)} average · ${totalDeals} deal${
        totalDeals === 1 ? "" : "s"
      }`}
    >
      {rows.length === 0 ? (
        <EmptyBlock>No deal revenue logged this period yet.</EmptyBlock>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((r) => (
            <DealSizeRowItem
              key={r.id}
              name={r.name}
              detail={r.detail}
              revenueUsd={r.revenueUsd}
              pctOfMax={maxUsd > 0 ? (r.revenueUsd / maxUsd) * 100 : 0}
            />
          ))}
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
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
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

function DealSizeRowItem({
  name,
  detail,
  revenueUsd,
  pctOfMax,
}: {
  name: string;
  detail: string;
  revenueUsd: number;
  pctOfMax: number;
}) {
  return (
    <li>
      <div className="px-1 py-1.5">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-court-fg">
              {name}
            </div>
            {detail ? (
              <div className="truncate text-[11px] text-court-fg-muted">
                {detail}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 text-sm font-semibold tabular-nums tracking-tight text-court-fg">
            {formatUsd(revenueUsd)}
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
    <div className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]">
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
        <div className="mt-4 flex h-28 gap-3">
          {quarterMonths.map((m) => {
            const usd = monthlyRevenue.get(m) ?? 0;
            const heightPct = maxMonthUsd > 0 ? (usd / maxMonthUsd) * 100 : 0;
            const isFuture = m > currentMonth;
            return (
              <div key={m} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="relative flex w-full flex-1 items-end justify-center">
                  {isFuture ? (
                    <div className="h-full w-10 rounded-lg border border-dashed border-court-border bg-transparent" />
                  ) : usd === 0 ? (
                    // $0 month renders no bar at all — not even the track —
                    // so it reads clearly distinct from a month with revenue.
                    // The empty slot still occupies its flex-1 height so the
                    // sibling APR/MAY/JUN labels stay aligned.
                    null
                  ) : (
                    // Track + fill mirrors the Submitted → Placed funnel
                    // on the Scoreboard tab: bg-court-surface-subtle round
                    // box with overflow-hidden, fill absolutely positioned
                    // and grown via height % from the bottom. Tint instead
                    // of solid brand — the dark fill read too heavy.
                    <div className="relative h-full w-10 overflow-hidden rounded-lg bg-court-surface-subtle">
                      <div
                        className="absolute inset-x-0 bottom-0 bg-court-brand-tint"
                        style={{ height: `${heightPct}%`, minHeight: 3 }}
                      />
                    </div>
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
