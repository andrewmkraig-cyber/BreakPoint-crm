const USD_NO_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatUsd(n: number): string {
  return USD_NO_CENTS.format(Math.round(n));
}

export type PnlData = {
  placementFeesUsd: number;
  totalIncomeUsd: number;
  recurringMonthlyUsd: number;
  recurringAnnualUsd: number;
  recurringEvery3YearsUsd: number;
  oneTimeUsd: number;
  totalExpensesUsd: number;
  grossProfitUsd: number;
  netMarginPct: number | null;
};

// Pure builder: takes the same YTD subtotals already computed for the
// Subscriptions card and returns the matching PnlData. Centralizing
// construction here guarantees the P&L card and the "YTD expenses"
// footer never drift — both render from the same source numbers.
export function buildPnlData(input: {
  placementFeesUsd: number;
  recurringMonthlyUsd: number;
  recurringAnnualUsd: number;
  recurringEvery3YearsUsd: number;
  oneTimeUsd: number;
}): PnlData {
  const {
    placementFeesUsd,
    recurringMonthlyUsd,
    recurringAnnualUsd,
    recurringEvery3YearsUsd,
    oneTimeUsd,
  } = input;
  const totalIncomeUsd = placementFeesUsd;
  const totalExpensesUsd =
    recurringMonthlyUsd +
    recurringAnnualUsd +
    recurringEvery3YearsUsd +
    oneTimeUsd;
  const grossProfitUsd = totalIncomeUsd - totalExpensesUsd;
  const netMarginPct =
    totalIncomeUsd > 0 ? (grossProfitUsd / totalIncomeUsd) * 100 : null;
  return {
    placementFeesUsd,
    totalIncomeUsd,
    recurringMonthlyUsd,
    recurringAnnualUsd,
    recurringEvery3YearsUsd,
    oneTimeUsd,
    totalExpensesUsd,
    grossProfitUsd,
    netMarginPct,
  };
}

export function PnlCard({ data }: { data: PnlData }) {
  const year = new Date().getFullYear();
  const profitPositive = data.grossProfitUsd >= 0;
  const netMarginLabel =
    data.netMarginPct == null
      ? "—"
      : `${data.netMarginPct.toFixed(1)}%`;
  const profitToneClass = profitPositive ? "text-court-brand" : "text-red-500";

  return (
    <div className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(16,36,24,0.04),0_12px_32px_rgba(16,36,24,0.04)]">
      <div>
        <p className="font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          Profit &amp; Loss
        </p>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          YTD {year} · placement fees vs operating spend
        </p>
      </div>

      <table className="mt-4 w-full text-sm text-court-fg">
        <tbody>
          <SectionHeaderRow label="Income" />
          <Row label="Placement Fees" value={formatUsd(data.placementFeesUsd)} />
          <Row label="Total Income" value={formatUsd(data.totalIncomeUsd)} bold />

          <SectionHeaderRow label="Expenses" />
          <Row label="Recurring Monthly" value={formatUsd(data.recurringMonthlyUsd)} />
          <Row label="Recurring Annual" value={formatUsd(data.recurringAnnualUsd)} />
          {data.recurringEvery3YearsUsd > 0 ? (
            <Row label="Every 3 Years" value={formatUsd(data.recurringEvery3YearsUsd)} />
          ) : null}
          <Row label="One-Time Charges" value={formatUsd(data.oneTimeUsd)} />
          <Row label="Total Expenses" value={formatUsd(data.totalExpensesUsd)} bold topDivider />

          <SectionHeaderRow label="Profit / Loss" />
          <Row
            label="Gross Profit"
            value={formatUsd(data.grossProfitUsd)}
            bold
            topDivider
            toneClass={profitToneClass}
          />
          <Row
            label="Net Margin %"
            value={netMarginLabel}
            bold
            toneClass={profitToneClass}
          />
        </tbody>
      </table>
    </div>
  );
}

function SectionHeaderRow({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={2}
        className="pt-4 pb-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-court-brand-dark"
      >
        {label}
      </td>
    </tr>
  );
}

function Row({
  label,
  value,
  bold,
  topDivider,
  toneClass,
}: {
  label: string;
  value: string;
  bold?: boolean;
  topDivider?: boolean;
  toneClass?: string;
}) {
  const labelClass = bold
    ? "font-semibold text-court-fg"
    : "text-court-fg-muted";
  const valueClass = [
    "tabular-nums text-right",
    bold ? "font-semibold" : "",
    toneClass ?? "text-court-fg",
  ]
    .filter(Boolean)
    .join(" ");
  const rowClass = topDivider ? "border-t border-court-border-soft" : "";
  return (
    <tr className={rowClass}>
      <td className={`py-1.5 ${labelClass}`}>{label}</td>
      <td className={`py-1.5 ${valueClass}`}>{value}</td>
    </tr>
  );
}
