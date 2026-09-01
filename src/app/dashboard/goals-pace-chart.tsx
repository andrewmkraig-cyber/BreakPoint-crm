const USD_SHORT = (n: number): string => {
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
};

export type PaceBucket = {
  label: string;
  // Cumulative billed revenue through the END of this bucket.
  cumulativeActual: number;
  // Where a straight line to target would be at the end of this bucket.
  requiredPace: number;
  // Buckets after today: the pace line still shows, the actual does not.
  isFuture: boolean;
};

// Cumulative actual vs required pace across the goal's period.
//
// HOW CHARTS ARE DRAWN IN THIS APP, and why this one looks like it does.
// There is no charting library and no SVG anywhere in the chart surfaces.
// The Scoreboard's Deal Funnel and the Finances TrendCard both use the same
// pure-CSS idiom: a rounded `bg-court-surface-subtle` track with
// `overflow-hidden`, and an absolutely positioned `bg-court-brand-tint`
// fill grown by a percentage width (funnel, horizontal) or height
// (TrendCard, vertical). TrendCard's own comment says it mirrors the
// funnel.
//
// That idiom CANNOT express a two-series line chart - it has no polyline,
// no path, no way to join points across columns. Rather than add a
// dependency, this builds the closest thing it can express honestly: one
// column per bucket, the cumulative actual as a vertical fill, and the
// required pace as a thin horizontal RULE across each column at its own
// height. Reading the rules left to right gives the pace line; a fill
// above its rule is ahead, below is behind. It is the same marker
// technique the revenue meter uses for expected-to-date.
export function GoalsPaceChart({
  title,
  subtitle,
  buckets,
  target,
}: {
  title: string;
  subtitle: string;
  buckets: PaceBucket[];
  target: number;
}) {
  // Scale to whichever is larger so an overshoot is visible rather than
  // clipped, and the pace rule never runs off the top.
  const peak = buckets.reduce(
    (m, b) => Math.max(m, b.cumulativeActual, b.requiredPace),
    0,
  );
  const scaleMax = Math.max(peak, target, 1);
  const pctOf = (n: number) => Math.min(100, Math.max(0, (n / scaleMax) * 100));
  const hasActual = buckets.some((b) => b.cumulativeActual > 0);

  return (
    <section className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Pace
        </p>
        <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-court-fg-muted">{subtitle}</p>
      </div>

      {!hasActual ? (
        <p className="mt-6 text-[13px] text-court-fg-muted">
          Nothing billed in this period yet, so there is no curve to draw. The
          required pace is {USD_SHORT(target)} across {buckets.length}{" "}
          {buckets.length === 1 ? "bucket" : "buckets"}.
        </p>
      ) : (
        <div className="mt-4 flex h-32 items-end gap-1.5">
          {buckets.map((b) => {
            const fillPct = pctOf(b.cumulativeActual);
            const pacePct = pctOf(b.requiredPace);
            return (
              <div key={b.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="relative h-full w-full overflow-hidden rounded-md bg-court-surface-subtle">
                  {!b.isFuture && (
                    <div
                      className="absolute inset-x-0 bottom-0 bg-court-brand-tint"
                      style={{ height: `${fillPct}%`, minHeight: 2 }}
                      aria-hidden
                    />
                  )}
                  {/* The pace "line": one rule per column at the height a
                      straight run to target would have reached. */}
                  <div
                    className="absolute inset-x-0 h-px bg-court-fg/60"
                    style={{ bottom: `${pacePct}%` }}
                    aria-hidden
                  />
                </div>
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-court-fg-muted">
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend, because the fill and the rule are two different series and
          neither is identified by its shape alone. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-court-brand-tint" aria-hidden />
          Cumulative billed
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-court-fg-muted">
          <span className="inline-block h-px w-3 bg-court-fg/60" aria-hidden />
          Required pace to {USD_SHORT(target)}
        </span>
      </div>

      {/* The same information as numbers, for anyone who does not read the
          columns. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-court-border-soft pt-3 sm:grid-cols-3">
        {buckets
          .filter((b) => !b.isFuture)
          .slice(-3)
          .map((b) => (
            <div key={b.label}>
              <dt className="text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
                {b.label}
              </dt>
              <dd className="mt-0.5 text-xs tabular-nums text-court-fg">
                {USD_SHORT(b.cumulativeActual)}
                <span className="text-court-fg-muted">
                  {" "}
                  vs {USD_SHORT(b.requiredPace)}
                </span>
              </dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
