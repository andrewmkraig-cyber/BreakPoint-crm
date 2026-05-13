import { PlacementsMapCard } from "@/components/placements/placements-map-card";
import { TabStrip } from "@/components/ui/tab-strip";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getPlacementsDashboardData,
  type PlacementsDashboardPeriod,
  type PlacementsDashboardRow,
} from "@/lib/placements-dashboard";
import { aggregateByCity } from "@/lib/placements-map-geo";

const PERIODS: ReadonlyArray<{ id: PlacementsDashboardPeriod; label: string }> = [
  { id: "YTD", label: `YTD ${new Date().getFullYear()}` },
  { id: "THIS_QUARTER", label: "This Quarter" },
  { id: "LAST_90_DAYS", label: "Last 90 Days" },
];

export function resolvePlacementsPeriod(
  raw: string | undefined | null,
): PlacementsDashboardPeriod {
  if (raw === "THIS_QUARTER" || raw === "LAST_90_DAYS") return raw;
  return "YTD";
}

export async function PlacementsTab({ period }: { period: PlacementsDashboardPeriod }) {
  const org = await getCurrentOrg();
  const rows = await getPlacementsDashboardData(org.id, period);
  const kpis = computeKpis(rows);
  const cities = aggregateByCity(rows);
  const totalFee = cities.reduce((s, c) => s + c.totalFee, 0);

  return (
    <div className="flex flex-col gap-7">
      <PlacementsHeader period={period} />
      <KpiStrip kpis={kpis} />
      <PlacementsMapCard cities={cities} totalFee={totalFee} />
    </div>
  );
}

function PlacementsHeader({ period }: { period: PlacementsDashboardPeriod }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
        Placements
      </p>
      <TabStrip<PlacementsDashboardPeriod>
        ariaLabel="Placements period"
        activeId={period}
        items={PERIODS.map((p) => ({
          id: p.id,
          label: p.label,
          href:
            p.id === "YTD"
              ? "/dashboard?tab=placements"
              : `/dashboard?tab=placements&period=${p.id}`,
        }))}
      />
    </div>
  );
}

type PlacementsKpis = {
  total: number;
  repeatClientCount: number;
  repeatClientRatePct: number | null;
  avgBaseSalary: number | null;
  directHireCount: number;
  offerToStartAvgDays: number | null;
  offerToStartFastestDays: number | null;
  offerToStartSampleCount: number;
  salaryCount: number;
  contractCount: number;
  directHireMixPct: number | null;
};

function computeKpis(rows: PlacementsDashboardRow[]): PlacementsKpis {
  const total = rows.length;
  const repeatClientCount = rows.filter((r) => r.clientHadPriorYearPlacement).length;
  const repeatClientRatePct = total > 0 ? Math.round((repeatClientCount / total) * 100) : null;

  const salaryRows = rows.filter((r) => r.placementType === "SALARY");
  const contractCount = rows.filter((r) => r.placementType === "CONTRACT").length;
  const salaryCount = salaryRows.length;
  const directHireMixPct = total > 0 ? Math.round((salaryCount / total) * 100) : null;

  const baseSalaryValues = salaryRows
    .map((r) => r.baseSalary)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  const avgBaseSalary =
    baseSalaryValues.length > 0
      ? Math.round(baseSalaryValues.reduce((s, n) => s + n, 0) / baseSalaryValues.length)
      : null;

  const leadTimes = rows
    .map((r) => {
      if (!r.offerAcceptedAt || !r.startDate) return null;
      const diffMs = r.startDate.getTime() - r.offerAcceptedAt.getTime();
      if (!Number.isFinite(diffMs) || diffMs < 0) return null;
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    })
    .filter((n): n is number => typeof n === "number");
  const offerToStartAvgDays =
    leadTimes.length > 0
      ? Math.round(leadTimes.reduce((s, n) => s + n, 0) / leadTimes.length)
      : null;
  const offerToStartFastestDays = leadTimes.length > 0 ? Math.min(...leadTimes) : null;

  return {
    total,
    repeatClientCount,
    repeatClientRatePct,
    avgBaseSalary,
    directHireCount: salaryCount,
    offerToStartAvgDays,
    offerToStartFastestDays,
    offerToStartSampleCount: leadTimes.length,
    salaryCount,
    contractCount,
    directHireMixPct,
  };
}

function formatMoneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function KpiStrip({ kpis }: { kpis: PlacementsKpis }) {
  const { total } = kpis;

  const tiles: Array<{ label: string; value: string; sub: string }> = [
    {
      label: "Repeat-Client Rate",
      value: kpis.repeatClientRatePct != null ? `${kpis.repeatClientRatePct}%` : "—",
      sub:
        total === 0
          ? "No placements in this window"
          : `${kpis.repeatClientCount} of ${total} ${
              total === 1 ? "placement" : "placements"
            } with prior-year clients`,
    },
    {
      label: "Avg Base Salary Placed",
      value: kpis.avgBaseSalary != null ? formatMoneyShort(kpis.avgBaseSalary) : "—",
      sub:
        kpis.directHireCount === 0
          ? "No direct-hire placements yet"
          : `Direct hires · ${kpis.directHireCount} ${
              kpis.directHireCount === 1 ? "placement" : "placements"
            }`,
    },
    {
      label: "Offer to Start",
      value: kpis.offerToStartAvgDays != null ? `${kpis.offerToStartAvgDays}d` : "—",
      sub:
        kpis.offerToStartAvgDays != null && kpis.offerToStartFastestDays != null
          ? `Avg lead time · fastest ${kpis.offerToStartFastestDays}d`
          : "Offer + start dates not yet captured",
    },
    {
      label: "Direct-Hire Mix",
      value: kpis.directHireMixPct != null ? `${kpis.directHireMixPct}%` : "—",
      sub:
        total === 0
          ? "0 direct · 0 contract"
          : `${kpis.salaryCount} direct · ${kpis.contractCount} contract`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <KpiTile key={t.label} {...t} />
      ))}
    </div>
  );
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  const isEmpty = value === "—";
  return (
    <div className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm transition hover:border-court-brand/40 hover:shadow-md">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
        {label}
      </p>
      <div
        className={
          "mt-2 font-sans text-[clamp(22px,2.6vw,38px)] font-extrabold leading-none tracking-[-0.035em] tabular-nums " +
          (isEmpty ? "text-court-fg-dim" : "text-court-fg")
        }
      >
        {value}
      </div>
      <p className="mt-3 truncate text-[11px] text-court-fg-muted">{sub}</p>
    </div>
  );
}
