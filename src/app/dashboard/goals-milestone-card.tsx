import type { MilestonePacing } from "@/lib/goals/pacing";
import { MILESTONE_RUN_RATE_DAYS } from "@/lib/goals/pacing";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

// Lifetime milestone. No period, so no pacing: a milestone cannot be
// "behind" against a window that does not exist. It reports how far along
// it is and, from the trailing 90-day run rate, roughly when it lands.
export function GoalsMilestoneCard({
  label,
  note,
  pacing,
}: {
  label: string;
  note: string | null;
  pacing: MilestonePacing;
}) {
  const pct = pacing.percentComplete ?? 0;

  return (
    <section className="flex flex-col rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
          Milestone
        </p>
        <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
          {label}
        </h3>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Lifetime cash collected, not billed.
        </p>
      </div>

      <p className="mt-4 font-serif text-[26px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-court-fg">
        {USD.format(Math.round(pacing.actual))}
        <span className="ml-2 font-sans text-[13px] font-medium tracking-normal text-court-fg-muted">
          of {USD.format(Math.round(pacing.target))}
        </span>
      </p>

      {/* Same track + fill idiom as the funnel and TrendCard. */}
      <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-court-bg ring-1 ring-inset ring-court-border">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-court-brand"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          aria-hidden
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Complete" value={`${pct.toFixed(1)}%`} />
        <Figure
          label={pacing.alreadyReached ? "Past target by" : "Remaining"}
          value={USD.format(Math.round(Math.abs(pacing.remaining)))}
        />
        <Figure
          label={`Run rate (${MILESTONE_RUN_RATE_DAYS}d)`}
          value={`${USD.format(Math.round(pacing.runRatePerDay))}/day`}
        />
        <Figure
          label="Projected to reach"
          // A null projected date is stated in WORDS, never printed as an
          // empty cell: at a zero run rate there is no honest date, and
          // "—" would read as missing data rather than as a stall.
          value={
            pacing.alreadyReached
              ? "Already reached"
              : pacing.projectedDate
                ? DATE.format(pacing.projectedDate)
                : "Not at this rate"
          }
          sub={
            pacing.alreadyReached
              ? undefined
              : pacing.projectedDate
                ? "at the current run rate"
                : `nothing collected in the last ${MILESTONE_RUN_RATE_DAYS} days`
          }
        />
      </dl>

      {note && (
        <p className="mt-4 border-t border-court-border-soft pt-3 text-xs italic text-court-fg-muted">
          {note}
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
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-court-fg">{value}</dd>
      {sub && <dd className="text-[10px] text-court-fg-muted">{sub}</dd>}
    </div>
  );
}
