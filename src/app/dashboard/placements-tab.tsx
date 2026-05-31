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
import { TimeRangeTabs } from "@/components/ui/time-range-selector";
import {
  DEFAULT_TIME_RANGE,
  timeRange,
  type TimeRangeSelection,
} from "@/lib/time-range";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  getPlacementsDashboardData,
  type PlacementsDashboardRow,
} from "@/lib/placements-dashboard";
import { aggregateByCity } from "@/lib/placements-map-geo";

// "All placements" ledger heading from the resolved window label, e.g.
// "All placements · Q2 2026" / "· YTD 2026" / "· Week of May 25-31, 2026".
// The current quarter keeps its original friendlier wording.
function ledgerTitleFor(selection: TimeRangeSelection, label: string): string {
  if (selection.grain === "QUARTER" && selection.period === "THIS") {
    return "All placements this quarter";
  }
  return `All placements · ${label}`;
}

export async function PlacementsTab({
  selection = DEFAULT_TIME_RANGE,
}: {
  selection?: TimeRangeSelection;
}) {
  const org = await getCurrentOrg();
  const range = timeRange(selection);
  const rows = await getPlacementsDashboardData(org.id, range);
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
        <TimeRangeTabs value={selection} ariaLabel="Placements period" />
      </div>
      <PlacementsLedger
        rows={ledgerRows}
        title={ledgerTitleFor(selection, range.label)}
      />
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
    // INVOICE_DRAFT (single-invoice DRAFT, added 2026-05-27) also
    // qualifies — confirmStart has fired so the candidate is in their
    // guarantee window even though the draft invoice hasn't been sent.
    if (
      r.billingStatus !== "BILLED" &&
      r.billingStatus !== "COLLECTED" &&
      r.billingStatus !== "INVOICED" &&
      r.billingStatus !== "INVOICE_DRAFT" &&
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

