import { GoalMeter, type MeterTier } from "@/app/dashboard/goal-meter";
import type { CumulativePacing } from "@/lib/goals/pacing";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function usd(n: number): string {
  return USD.format(Math.round(n));
}

// Revenue is the THREE-TIER variant of the shared GoalMeter, not a separate
// component. Its chrome, percent, pace marker and figures all come from
// GoalMeter (Ace 99.3); what is particular to revenue is only the fill.
//
// The three fills are NESTED, not stacked end to end. earned >= billed >=
// collected describes the same money at three stages of one pipe, so
// drawing them as segments that add up would triple-count it. Each is drawn
// from the left edge at its own absolute width, widest behind narrowest.
//
// COLOUR IS NEVER THE ONLY CUE. The bands differ by brand-green opacity,
// and opacity alone fails for anyone who cannot separate the steps - so
// every tier is also named in the legend AND printed as its own labelled
// dollar figure. That redundancy is load-bearing: measured in Chrome, the
// lightest band reads 1.53:1 at clay/light, under the 3:1 non-text floor,
// and alpha on brand cannot clear it (solid brand itself tops out at 3.26
// there). See ACE_DESIGN.md.
export function GoalsRevenueMeter({
  title,
  periodWord,
  periodLabel,
  pacing,
  showDaysRemaining,
  actualsOnly,
}: {
  title: string;
  periodWord: string;
  periodLabel: string;
  pacing: CumulativePacing;
  showDaysRemaining?: boolean;
  actualsOnly?: boolean;
}) {
  const { revenue } = pacing;
  // `pacing.actual` IS earned (Ace 99.1), so it is the right fallback for
  // earned and the wrong one for billed - a missing revenue detail leaves
  // billed at 0 rather than silently mirroring the earned figure.
  const tiers: MeterTier[] = [
    {
      key: "earned",
      label: "Earned",
      value: revenue?.earned ?? pacing.actual,
      fill: "bg-court-brand/40",
    },
    { key: "billed", label: "Billed", value: revenue?.billed ?? 0, fill: "bg-court-brand/75" },
    { key: "collected", label: "Collected", value: revenue?.collected ?? 0, fill: "bg-court-brand" },
  ];

  return (
    <GoalMeter
      title={title}
      periodWord={periodWord}
      periodLabel={periodLabel}
      pacing={pacing}
      format={usd}
      // Revenue leads with the dollar figure; percent moves to the
      // supporting line. The count meters keep percent as the focal number.
      focus="value"
      showDaysRemaining={showDaysRemaining}
      actualsOnly={actualsOnly}
      fill={{ kind: "tiers", tiers }}
      footnote={
        revenue?.billedExceedsEarned ? (
          <p className="mt-4 rounded-lg bg-court-surface-subtle px-3 py-2 text-[11px] text-court-fg-muted">
            Billed is above earned for this period, which means an invoice has no
            live placement behind it. Both figures are shown as measured - neither
            has been adjusted.
          </p>
        ) : undefined
      }
    />
  );
}
