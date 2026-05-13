import {
  CircleDollarSign,
  PercentCircle,
  Scale,
  Sparkles,
  Wallet,
} from "lucide-react";
import { KpiTile } from "@/app/dashboard/kpi-tile";
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

// Net margin stays at 0% until Mercury (bank feed) wires in operating
// expenses beyond software tools — payroll, contractor pay, overhead.
// Until then we don't have the inputs to compute it honestly.
const NET_MARGIN_PLACEHOLDER_PCT = 0;

export async function FinancialPerformanceTab() {
  const org = await getCurrentOrg();

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const yearEnd = new Date(new Date().getFullYear() + 1, 0, 1);

  const [revenueInvoices, toolExpenses] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId: org.id,
        status: { in: ["SENT", "PAID"] },
        OR: [
          { sentAt: { gte: yearStart, lt: yearEnd } },
          { paidAt: { gte: yearStart, lt: yearEnd } },
        ],
      },
      select: { feeAmount: true },
    }),
    prisma.toolExpense.findMany({
      where: { organizationId: org.id },
      select: { cost: true, paidCount: true },
    }),
  ]);

  const revenueUsd = revenueInvoices.reduce((sum, r) => {
    if (r.feeAmount == null) return sum;
    const n = Number(r.feeAmount.toString());
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

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

  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Financial Performance
        </p>
        <h2 className="mt-1 font-serif text-2xl font-extrabold tracking-tight text-court-fg sm:text-3xl">
          Revenue, margins, and ROI
        </h2>
        <p className="mt-1 max-w-xl text-sm text-court-fg-muted">
          Year-to-date revenue from sent + paid invoices, against tool
          expenses on the desk. Net margin lands when Mercury wires in.
        </p>
      </div>

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
        <KpiTile
          label="Net Margin"
          value={netMarginLabel}
          icon={Scale}
        />
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
    </div>
  );
}
