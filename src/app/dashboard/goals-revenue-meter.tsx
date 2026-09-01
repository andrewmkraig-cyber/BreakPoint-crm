import {
  pacingForCumulative,
  type CumulativePacing,
} from "@/lib/goals/pacing";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function usd(n: number): string {
  return USD.format(Math.round(n));
}

// The focal element of the Goals tab: one bar carrying all three revenue
// tiers plus the expected-to-date marker, so "am I ahead or behind" reads
// without any arithmetic.
//
// The three fills are NESTED, not stacked end to end. earned >= billed >=
// collected describes the same money at three stages of the same pipe, so
// drawing them as three segments that add up would triple-count it. Each
// fill is drawn from the left edge at its own width, widest behind
// narrowest, which is why the widths are absolute percentages of target
// rather than deltas.
//
// COLOUR IS NEVER THE ONLY CUE. The three fills differ by brand-green
// opacity, and opacity alone fails for anyone who cannot separate the
// steps - so every tier is also named in the legend AND printed as its own
// labelled dollar figure underneath. All three come from --court-brand via
// Tailwind's alpha syntax, so they re-skin with the surface and stay legible
// in light and dark across all seven Court palettes; no hex appears here.
export function GoalsRevenueMeter({
  goalLabel,
  periodLabel,
  pacing,
}: {
  goalLabel: string;
  periodLabel: string;
  pacing: CumulativePacing;
}) {
  const { target, revenue } = pacing;
  // `pacing.actual` IS earned (Ace 99.0), so it is the right fallback for
  // earned and the wrong one for billed - a missing revenue detail leaves
  // billed at 0 rather than silently mirroring the earned figure.
  const earned = revenue?.earned ?? pacing.actual;
  const billed = revenue?.billed ?? 0;
  const collected = revenue?.collected ?? 0;

  // Scale so the bar can show an overshoot: if any tier beats target, the
  // bar's 100% becomes that tier rather than clipping the win off.
  const scaleMax = Math.max(target, earned, billed, collected, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scaleMax) * 100))}%`;
  const expectedPct = target > 0 ? (pacing.expectedToDate / scaleMax) * 100 : 0;

  const statusLabel =
    pacing.status === "AHEAD"
      ? "Ahead"
      : pacing.status === "ON_PACE"
        ? "On pace"
        : pacing.status === "BEHIND"
          ? "Behind"
          : "Unknown";

  const tiers = [
    { key: "earned", label: "Earned", value: earned, fill: "bg-court-brand/25" },
    { key: "billed", label: "Billed", value: billed, fill: "bg-court-brand/60" },
    { key: "collected", label: "Collected", value: collected, fill: "bg-court-brand" },
  ];

  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
            {goalLabel}
          </p>
          <p className="mt-1 font-serif text-[26px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
            {usd(earned)}
            <span className="ml-2 font-sans text-[13px] font-medium tracking-normal text-court-fg-muted">
              earned of {usd(target)} · {periodLabel}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
            Pace
          </p>
          <p className="mt-1 text-[15px] font-semibold text-court-fg">
            {statusLabel}
            {pacing.paceIndex !== null && (
              <span className="ml-1.5 text-[13px] font-medium tabular-nums text-court-fg-muted">
                {pacing.paceIndex.toFixed(2)}&times;
              </span>
            )}
          </p>
        </div>
      </div>

      {/* The bar. Nested fills, widest first, so each tier reads as a
          prefix of the one behind it. */}
      <div className="relative mt-4 h-7 w-full overflow-hidden rounded-lg bg-court-surface-subtle">
        {tiers.map((t) => (
          <div
            key={t.key}
            className={`absolute inset-y-0 left-0 rounded-lg ${t.fill}`}
            style={{ width: pct(t.value) }}
            aria-hidden
          />
        ))}
        {/* Expected-to-date marker. Sits above every fill so it stays
            visible when the bar has run past it. */}
        {target > 0 && pacing.daysElapsed > 0 && (
          <div
            className="absolute inset-y-0 z-10 w-0.5 bg-court-fg"
            style={{ left: `${Math.min(100, Math.max(0, expectedPct))}%` }}
            aria-hidden
          />
        )}
      </div>

      {/* Legend. This is what carries the tier identities for anyone who
          cannot separate three steps of one green. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {tiers.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${t.fill}`} aria-hidden />
            {t.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
          <span className="inline-block h-2.5 w-0.5 bg-court-fg" aria-hidden />
          Expected to date
        </span>
      </div>

      {/* The numbers. Screen readers and anyone who skips the bar get the
          same information here in full. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {tiers.map((t) => (
          <Figure key={t.key} label={t.label} value={usd(t.value)} />
        ))}
        <Figure label="Target" value={usd(target)} />
        <Figure
          label={pacing.gapToTarget > 0 ? "Gap to target" : "Past target by"}
          value={usd(Math.abs(pacing.gapToTarget))}
        />
        <Figure label="Expected to date" value={usd(pacing.expectedToDate)} />
        <Figure
          label="Days remaining"
          value={`${pacing.daysRemaining} of ${pacing.daysInPeriod}`}
        />
        <Figure
          label="Projected finish"
          value={pacing.projectedFinish === null ? "—" : usd(pacing.projectedFinish)}
          sub={pacing.projectedFinish === null ? "period not started" : "at current pace"}
        />
      </dl>

      {revenue?.billedExceedsEarned && (
        <p className="mt-4 rounded-lg bg-court-surface-subtle px-3 py-2 text-[11px] text-court-fg-muted">
          Billed is above earned for this period, which means an invoice has no
          live placement behind it. Both figures are shown as measured — neither
          has been adjusted.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-court-fg">
        {value}
      </dd>
      {sub && <dd className="text-[10px] text-court-fg-dim">{sub}</dd>}
    </div>
  );
}

// Convenience for the tab: build the pacing result a meter needs from a
// goal plus its resolved revenue.
export function meterPacing(input: Parameters<typeof pacingForCumulative>[0]) {
  return pacingForCumulative(input);
}
