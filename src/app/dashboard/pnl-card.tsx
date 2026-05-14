import { prisma } from "@/lib/prisma";

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

export type PnlData = {
  placementFeesUsd: number;
  totalIncomeUsd: number;
  recurringMonthlyUsd: number;
  recurringAnnualUsd: number;
  oneTimeUsd: number;
  totalExpensesUsd: number;
  grossProfitUsd: number;
  netMarginPct: number | null;
};

// Pulls PAID invoices and all ToolExpense rows for the current calendar
// year, then buckets ToolExpense into monthly / annual / one-time based
// on the frequency string. Quarterly entries fall into the monthly
// bucket — matches how the Expenses tab normalizes them today.
export async function getPnlData(
  organizationId: string,
  now: Date = new Date(),
): Promise<PnlData> {
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const [paidInvoices, toolExpenses] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: "PAID",
        paidAt: { gte: yearStart, lt: yearEnd },
      },
      select: { feeAmount: true },
    }),
    prisma.toolExpense.findMany({
      where: { organizationId },
      select: { cost: true, paidCount: true, frequency: true },
    }),
  ]);

  const placementFeesUsd = paidInvoices.reduce(
    (s, r) => s + decimalToNumber(r.feeAmount),
    0,
  );
  const totalIncomeUsd = placementFeesUsd;

  let recurringMonthlyUsd = 0;
  let recurringAnnualUsd = 0;
  let oneTimeUsd = 0;
  for (const m of toolExpenses) {
    const paid = m.paidCount > 0 ? m.paidCount : 1;
    const total = m.cost * paid;
    const freq = m.frequency.trim().toLowerCase();
    if (freq === "monthly" || freq === "quarterly") {
      recurringMonthlyUsd += total;
    } else if (freq === "annual" || freq === "annually" || freq === "yearly") {
      recurringAnnualUsd += total;
    } else {
      oneTimeUsd += total;
    }
  }
  const totalExpensesUsd = recurringMonthlyUsd + recurringAnnualUsd + oneTimeUsd;
  const grossProfitUsd = totalIncomeUsd - totalExpensesUsd;
  const netMarginPct =
    totalIncomeUsd > 0 ? (grossProfitUsd / totalIncomeUsd) * 100 : null;

  return {
    placementFeesUsd,
    totalIncomeUsd,
    recurringMonthlyUsd,
    recurringAnnualUsd,
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
