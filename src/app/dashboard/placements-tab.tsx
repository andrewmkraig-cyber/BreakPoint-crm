import { PlacementsBreakdowns } from "@/components/placements/placements-breakdowns";
import {
  GuaranteePeriodTable,
  type GuaranteePeriodRow,
} from "@/components/placements/guarantee-period-table";
import { resolveGuaranteeEnd } from "@/components/placements/guarantee-period-utils";
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
  // Active guarantees: Billed (invoice SENT) or Paid (invoice PAID), with a
  // resolved start date and a guarantee end still in the future. The live
  // countdown + zero-day drop happen client-side inside GuaranteePeriodTable.
  const guaranteeRows = toGuaranteeRows(ledgerRows);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand">
          PLACEMENTS ON THE BOOKS
        </p>
        <PeriodTabs period={period} />
      </div>
      <PlacementsLedger rows={ledgerRows} title={LEDGER_TITLE[period]} />
      <GuaranteePeriodTable rows={guaranteeRows} />
      <PlacementsBreakdowns rows={rows} />
      <PlacementsMapCard cities={cities} totalFee={totalFee} />
    </div>
  );
}

function toGuaranteeRows(rows: LedgerRow[]): GuaranteePeriodRow[] {
  const out: GuaranteePeriodRow[] = [];
  for (const r of rows) {
    // Any status that implies confirmStart has fired qualifies for the
    // guarantee-period table. BILLED/COLLECTED cover the single-invoice
    // path; INVOICED/PARTIALLY_PAID are the split-payment equivalents
    // (invoices exist as DRAFT/SENT, or some have already paid).
    if (
      r.billingStatus !== "BILLED" &&
      r.billingStatus !== "COLLECTED" &&
      r.billingStatus !== "INVOICED" &&
      r.billingStatus !== "PARTIALLY_PAID"
    ) {
      continue;
    }
    if (!r.expectedStartDateIso) continue;
    const guaranteeEndIso = resolveGuaranteeEnd({
      startDateIso: r.expectedStartDateIso,
      guaranteePeriodDays: r.guaranteePeriodDays,
      customGuaranteeDateIso: r.customGuaranteeDate,
    });
    if (!guaranteeEndIso) continue;
    out.push({
      placementId: r.id,
      candidateName: r.candidateFullName,
      clientName: r.clientName,
      roleTitle: r.roleTitle,
      startDateIso: r.expectedStartDateIso,
      guaranteeEndIso,
    });
  }
  return out;
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
    useCustomTerms: r.useCustomTerms,
    installmentCount: r.installmentCount,
    inst1Amount: r.inst1Amount,
    inst1DaysAfterStart: r.inst1DaysAfterStart,
    inst2Amount: r.inst2Amount,
    inst2DaysAfterStart: r.inst2DaysAfterStart,
    inst3Amount: r.inst3Amount,
    inst3DaysAfterStart: r.inst3DaysAfterStart,
    customGuaranteeDate: r.customGuaranteeDate
      ? r.customGuaranteeDate.toISOString()
      : null,
    guaranteePeriodDays: r.guaranteePeriodDays,
  }));
}

