import { PlacementsBreakdowns } from "@/components/placements/placements-breakdowns";
import {
  PlacementsLedger,
  type LedgerRow,
} from "@/components/placements/placements-ledger";
import { PlacementsMapCard } from "@/components/placements/placements-map-card";
import { KpiTile } from "@/app/dashboard/kpi-tile";
import { PeriodTabs } from "@/app/dashboard/period-tabs";
import { resolveDashboardPeriod } from "@/app/dashboard/period-tabs-shared";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getPlacementsDashboardData,
  type PlacementsDashboardPeriod,
  type PlacementsDashboardRow,
} from "@/lib/placements-dashboard";
import { aggregateByCity, formatMoneyShort } from "@/lib/placements-map-geo";

export function resolvePlacementsPeriod(
  raw: string | undefined | null,
): PlacementsDashboardPeriod {
  return resolveDashboardPeriod(raw);
}

const LEDGER_TITLE: Record<PlacementsDashboardPeriod, string> = {
  YTD: `All placements YTD ${new Date().getFullYear()}`,
  THIS_QUARTER: "All placements this quarter",
  LAST_QUARTER: "All placements · last quarter",
  NEXT_QUARTER: "All placements · next quarter",
};

export async function PlacementsTab({ period }: { period: PlacementsDashboardPeriod }) {
  const org = await getCurrentOrg();
  const rows = await getPlacementsDashboardData(org.id, period);
  const cities = aggregateByCity(rows);
  const totalFee = cities.reduce((s, c) => s + c.totalFee, 0);
  const ledgerRows = toLedgerRows(rows);
  const metrics = computeMetrics(rows);

  return (
    <div className="flex flex-col gap-6 rounded-2xl bg-court-brand-tint p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          PLACEMENTS ON THE BOOKS
        </p>
        <PeriodTabs period={period} />
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-2xl">
        <KpiTile
          label="Fees"
          value={metrics.fees > 0 ? formatMoneyShort(metrics.fees) : "—"}
          zeroDim
        />
        <KpiTile
          label="Revenue"
          value={metrics.revenue > 0 ? formatMoneyShort(metrics.revenue) : "—"}
          zeroDim
        />
        <KpiTile
          label="Pending Starts"
          value={String(metrics.pendingStarts)}
          zeroDim
        />
      </div>
      <PlacementsLedger rows={ledgerRows} title={LEDGER_TITLE[period]} />
      <PlacementsBreakdowns rows={rows} />
      <PlacementsMapCard cities={cities} totalFee={totalFee} />
    </div>
  );
}

function computeMetrics(rows: PlacementsDashboardRow[]): {
  fees: number;
  revenue: number;
  pendingStarts: number;
} {
  let fees = 0;
  let revenue = 0;
  let pendingStarts = 0;
  for (const r of rows) {
    const fee = r.feeAmount != null && Number.isFinite(r.feeAmount) && r.feeAmount > 0 ? r.feeAmount : 0;
    fees += fee;
    if (r.billingStatus === "COLLECTED") revenue += fee;
    if (r.billingStatus === "PENDING_START") pendingStarts += 1;
  }
  return { fees, revenue, pendingStarts };
}

function toLedgerRows(rows: PlacementsDashboardRow[]): LedgerRow[] {
  // Dates serialize through the server/client boundary as ISO strings;
  // formatting here means the client component never touches Date.
  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    candidateId: r.candidateId,
    candidateFullName: r.candidateFullName,
    invoiceId: r.invoiceId,
    clientName: r.clientName,
    clientIndustry: r.clientIndustry,
    roleTitle: r.roleTitle,
    city: r.city,
    cityOverride: r.cityOverride,
    startDateLabel: r.startDate
      ? r.startDate.toISOString().slice(0, 10)
      : null,
    expectedStartDateIso: r.startDate ? r.startDate.toISOString() : null,
    feeAmount: r.feeAmount,
    feeTotal: r.feeTotal,
    feePercentage: r.feePercentage,
    placementNotes: r.placementNotes,
    acceptedSalary: r.baseSalary,
    candidateSource: r.leadSource ?? null,
    billingStatus: r.billingStatus,
    leadSource: r.leadSource ?? null,
  }));
}

