import { PaceChip } from "@/app/dashboard/goals-chip";
import type { CumulativePacing } from "@/lib/goals/pacing";

// The shared meter card. Every CUMULATIVE goal renders through this; the
// revenue meter is one variant of it, not a separate component.
//
// WHAT EVERY METER SHOWS, in this order: the metric label, percent complete
// as the largest element, actual against target, the fill, the
// expected-to-date pace marker, then gap / days remaining / projection as
// figures, with the pace chip top-right.
//
// RATIO goals never reach this component. An average converges rather than
// accumulating, so "percent toward target" is a meaningless number for one -
// AVG_DEAL_SIZE keeps its list-row treatment (see goals-list-panel.tsx).

// One drawn band. Revenue passes three (earned / billed / collected) and
// they are NESTED, not stacked: the same money at three stages, so widths
// are absolute percentages of the scale rather than deltas.
export type MeterTier = {
  key: string;
  label: string;
  value: number;
  fill: string;
};

export type MeterFill =
  // Revenue: three nested bands plus a legend.
  | { kind: "tiers"; tiers: MeterTier[] }
  // Any continuous cumulative metric.
  | { kind: "single" }
  // Whole-unit counts: one segment per unit, so 4 of 9 reads as four filled
  // segments and five empty without anyone reading a number.
  | { kind: "segments"; units: number };

// Above this many units a segmented bar stops being countable at a glance
// and becomes visual noise, so it falls back to a continuous fill.
//
// The prompt proposed 25. MEASURED in Chrome rather than guessed. Real
// track widths in the headline row: 330px at 1440px viewport (three cards
// across at xl) and 302px on a 390px phone. With the 4px inter-segment gap:
//   20 segments -> (302 - 19*4) / 20 = 11.3px each on mobile, 12.7px desktop
//   25 segments -> (302 - 24*4) / 25 =  8.2px each on mobile
// Below roughly 10px a segment stops reading as a countable division and
// starts reading as texture, so 20 is the limit and 25 is not. A 9-unit
// goal - the live signed-clients and placements targets - draws at 33px
// desktop and 30px mobile, which is comfortably countable.
export const SEGMENT_LIMIT = 20;

function pctOf(value: number, scaleMax: number): number {
  if (scaleMax <= 0) return 0;
  return Math.min(100, Math.max(0, (value / scaleMax) * 100));
}

export function GoalMeter({
  title,
  periodWord,
  periodLabel,
  pacing,
  fill,
  format,
  // Which number leads the card. "percent" (the default) makes percent
  // complete the largest element on every meter, per the Ace 99.3 rule.
  // The revenue card passes "value" to lead with the dollar figure and
  // demote the percent to the supporting line - presentation only, the
  // calculation is identical either way.
  focus = "percent",
  // When the three headline cards share one window (Month and above), Days
  // remaining is identical on all of them and is hoisted to page level, so
  // it is dropped from the card grid. At Day/Week the cards do not share a
  // window and it stays per-card. Default true keeps every other caller
  // unchanged.
  showDaysRemaining = true,
  // Rendered under the figures. Revenue uses it for the
  // billed-exceeds-earned notice.
  footnote,
}: {
  // The metric name (Revenue / Signed Clients / Placements) - the card
  // title, the largest text in the header.
  title: string;
  // The grain word (Yearly / Quarterly / Monthly ...) - small and muted
  // beside the title.
  periodWord: string;
  periodLabel: string;
  pacing: CumulativePacing;
  fill: MeterFill;
  // How this metric's numbers read - currency for revenue, plain counts
  // for everything else.
  format: (n: number) => string;
  focus?: "percent" | "value";
  showDaysRemaining?: boolean;
  footnote?: React.ReactNode;
}) {
  const { target, actual } = pacing;

  // Percent counts PAST 100 - a quarter finished at 118% should say so -
  // while the fill itself caps at the track. Those are two different
  // numbers on purpose.
  const percentComplete = target > 0 ? (actual / target) * 100 : null;
  const isComplete = percentComplete !== null && percentComplete >= 100;

  // The fill scale never exceeds the target, so a bar can reach the end of
  // its track but never overflow it.
  const scaleMax = Math.max(target, 1);
  const expectedPct = pctOf(pacing.expectedToDate, scaleMax);

  return (
    <section
      className={
        "flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]" +
        // The complete treatment: a brand ring around the whole card, so a
        // finished goal reads as finished from across the row without
        // relying on the bar being visually full.
        (isComplete ? " ring-1 ring-court-brand" : "")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {/* The metric name is the card title - the largest text in the
              header - with the grain word small and muted beside it. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-serif text-lg font-bold tracking-tight text-court-fg">
              {title}
            </p>
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
              {periodWord}
            </span>
          </div>
          {/* The focal number: percent complete by default (largest element
              on every meter, Ace 99.3), or the dollar figure when the card
              asks to lead with value (revenue). The raw figures sit
              immediately under it so the number that matters and the number
              it came from are read together. */}
          <p className="mt-1 font-serif text-[32px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
            {focus === "value"
              ? format(actual)
              : percentComplete === null
                ? "—"
                : `${Math.round(percentComplete)}%`}
            {isComplete && (
              <span className="ml-2 align-middle text-[11px] font-sans font-extrabold uppercase tracking-wide text-court-brand">
                Complete
              </span>
            )}
          </p>
          <p className="mt-1 text-[13px] text-court-fg-muted">
            {/* The demoted figure keeps the leading-token emphasis the
                supporting line has always used - the dollar actual under a
                percent focus, or the percent under a value focus. */}
            <span className="font-semibold tabular-nums text-court-fg">
              {focus === "value"
                ? percentComplete === null
                  ? "—"
                  : `${Math.round(percentComplete)}%`
                : format(actual)}
            </span>
            {" of "}
            {format(target)} · {periodLabel}
          </p>
        </div>
        <PaceChip status={pacing.status} />
      </div>

      <MeterBar fill={fill} pacing={pacing} scaleMax={scaleMax} expectedPct={expectedPct} />

      {fill.kind === "tiers" && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {fill.tiers.map((t) => (
            <span
              key={t.key}
              className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted"
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${t.fill}`} aria-hidden />
              {t.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
            <span className="inline-block h-2.5 w-0.5 bg-court-fg" aria-hidden />
            Expected to date
          </span>
        </div>
      )}

      {/* The same information as text. Anyone who skips the bar entirely,
          or cannot separate its bands, still gets every figure. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {fill.kind === "tiers" &&
          fill.tiers.map((t) => <Figure key={t.key} label={t.label} value={format(t.value)} />)}
        <Figure label="Target" value={format(target)} />
        <Figure
          label={pacing.gapToTarget > 0 ? "Gap to target" : "Past target by"}
          value={format(Math.abs(pacing.gapToTarget))}
        />
        <Figure label="Expected to date" value={format(pacing.expectedToDate)} />
        {/* Hoisted to page level when the headline cards share one window
            (Month and above); kept here at Day/Week where they do not. */}
        {showDaysRemaining && (
          <Figure
            label="Days remaining"
            value={`${pacing.daysRemaining} of ${pacing.daysInPeriod}`}
          />
        )}
        <Figure
          label="Projected finish"
          value={pacing.projectedFinish === null ? "—" : format(pacing.projectedFinish)}
          sub={pacing.projectedFinish === null ? "period not started" : "at current pace"}
        />
      </dl>

      {footnote}
    </section>
  );
}

// The bar itself. Three shapes share one track so the chrome, the height,
// and the pace marker behave identically whichever fill is drawn.
function MeterBar({
  fill,
  pacing,
  scaleMax,
  expectedPct,
}: {
  fill: MeterFill;
  pacing: CumulativePacing;
  scaleMax: number;
  expectedPct: number;
}) {
  // Track is bg-court-bg, NOT surface-subtle: measured in Chrome across all
  // eight Court combinations, solid brand reaches only 2.90:1 against
  // surface-subtle at clay/light but 3.26:1 against court-bg, clearing the
  // 3:1 non-text floor everywhere. The ring keeps the bar's extent visible
  // where brand still sits close to the track.
  const TRACK =
    "relative mt-4 h-7 w-full overflow-hidden rounded-lg bg-court-bg ring-1 ring-inset ring-court-border";

  if (fill.kind === "segments") {
    const filledUnits = Math.max(0, Math.min(fill.units, Math.round(pacing.actual)));
    return (
      <div className="mt-4">
        {/* One element per unit. flex + gap does the arithmetic, so a
            segment can never be pushed outside the track by rounding. */}
        <div
          className="flex h-7 w-full gap-1"
          role="img"
          aria-label={`${filledUnits} of ${fill.units} complete`}
        >
          {Array.from({ length: fill.units }, (_, i) => (
            <div
              key={i}
              className={
                "h-full flex-1 rounded-[3px] ring-1 ring-inset ring-court-border " +
                (i < filledUnits ? "bg-court-brand" : "bg-court-bg")
              }
              aria-hidden
            />
          ))}
        </div>
        {/* The pace marker rides under a segmented bar rather than through
            it: drawn over the top it would read as another divider. */}
        {pacing.daysElapsed > 0 && (
          <div className="relative mt-1 h-1.5 w-full">
            <div
              className="absolute top-0 h-1.5 w-0.5 bg-court-fg"
              style={{ left: `${expectedPct}%` }}
              aria-hidden
            />
          </div>
        )}
      </div>
    );
  }

  const tiers: MeterTier[] =
    fill.kind === "tiers"
      ? fill.tiers
      : [{ key: "actual", label: "Actual", value: pacing.actual, fill: "bg-court-brand" }];

  return (
    <div className={TRACK}>
      {tiers.map((t) => (
        <div
          key={t.key}
          className={`absolute inset-y-0 left-0 rounded-lg ${t.fill}`}
          style={{ width: `${pctOf(t.value, scaleMax)}%` }}
          aria-hidden
        />
      ))}
      {pacing.daysElapsed > 0 && (
        <div
          className="absolute inset-y-0 z-10 w-0.5 bg-court-fg"
          style={{ left: `${expectedPct}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-court-fg">{value}</dd>
      {sub && <dd className="text-[10px] text-court-fg-muted">{sub}</dd>}
    </div>
  );
}

// Whether a goal's target can be drawn as countable segments.
export function shouldSegment(target: number): boolean {
  return Number.isInteger(target) && target > 0 && target <= SEGMENT_LIMIT;
}
