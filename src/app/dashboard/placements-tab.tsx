import { PlacementsBreakdowns } from "@/components/placements/placements-breakdowns";
import {
  PlacementsLedger,
  type LedgerRow,
} from "@/components/placements/placements-ledger";
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
  const cities = aggregateByCity(rows);
  const totalFee = cities.reduce((s, c) => s + c.totalFee, 0);
  const ledgerRows = toLedgerRows(rows);
  const ledgerTitle =
    period === "YTD"
      ? `All placements YTD ${new Date().getFullYear()}`
      : period === "THIS_QUARTER"
        ? "All placements this quarter"
        : "All placements · last 90 days";

  return (
    <div className="flex flex-col gap-5">
      <PlacementsHeader period={period} />
      <PlacementsLedger rows={ledgerRows} title={ledgerTitle} />
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
  }));
}

function PlacementsHeader({ period }: { period: PlacementsDashboardPeriod }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Placements
        </p>
        <h2 className="mt-1 font-serif text-2xl font-extrabold tracking-tight text-court-fg sm:text-3xl">
          Placements on the books.
        </h2>
        <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
          Every hire and pending start in the selected window: the map, the full
          ledger, and the breakdowns below.
        </p>
      </div>
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
