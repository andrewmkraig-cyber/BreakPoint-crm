import { PlacementsBreakdowns } from "@/components/placements/placements-breakdowns";
import {
  PlacementsLedger,
  type LedgerRow,
} from "@/components/placements/placements-ledger";
import { PlacementsMapCard } from "@/components/placements/placements-map-card";
import { PeriodTabs } from "@/app/dashboard/period-tabs";
import { resolveDashboardPeriod } from "@/app/dashboard/period-tabs-shared";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getPlacementsDashboardData,
  type PlacementsDashboardPeriod,
  type PlacementsDashboardRow,
} from "@/lib/placements-dashboard";
import { aggregateByCity } from "@/lib/placements-map-geo";

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

  return (
    <div className="flex flex-col gap-6 pt-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          PLACEMENTS ON THE BOOKS
        </p>
        <PeriodTabs period={period} />
      </div>
      <PlacementsLedger rows={ledgerRows} title={LEDGER_TITLE[period]} />
      <PlacementsBreakdowns rows={rows} />
      <PlacementsMapCard cities={cities} totalFee={totalFee} />
    </div>
  );
}

function toLedgerRows(rows: PlacementsDashboardRow[]): LedgerRow[] {
  // Dates serialize through the server/client boundary as ISO strings;
  // formatting here means the client component never touches Date.
  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidateId,
    candidateFullName: r.candidateFullName,
    invoiceId: r.invoiceId,
    clientName: r.clientName,
    clientIndustry: r.clientIndustry,
    roleTitle: r.roleTitle,
    city: r.city,
    startDateLabel: r.startDate
      ? r.startDate.toISOString().slice(0, 10)
      : null,
    feeAmount: r.feeAmount,
    billingStatus: r.billingStatus,
    leadSource: r.leadSource ?? null,
  }));
}

