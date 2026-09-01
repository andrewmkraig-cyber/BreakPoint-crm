import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { PaceChip } from "@/app/dashboard/goals-chip";
import type { GoalMetric } from "@prisma/client";
import type { PacingStatus, RatioTrend } from "@/lib/goals/pacing";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const METRIC_LABEL: Record<GoalMetric, string> = {
  REVENUE: "Revenue",
  SIGNED_CLIENTS: "Signed Clients",
  PLACEMENTS: "Placements",
  SUBMITTALS: "Submittals",
  INTERVIEWS: "Interviews",
  BD_CONTACTS_ENROLLED: "BD Contacts Enrolled",
  BD_REPLIES: "BD Replies",
  AVG_DEAL_SIZE: "Avg Deal Size",
  MANUAL: "Manual",
};

// One row of the goal list. Two shapes, kept apart the way the pacing
// engine keeps them apart: CUMULATIVE rows accumulate toward a target and
// get a progress bar, RATIO rows are an average that converges and get
// neither a bar nor a projection.
export type GoalListRow = {
  id: string;
  metric: GoalMetric;
  label: string;
  isMoney: boolean;
  ownerName: string | null;
  windowLabel: string;
  target: number;
  // Null means the metric is not measurable, and must never render as 0.
  actual: number | null;
  notTrackedReason?: string;
  status: PacingStatus | null;
  isMilestone: boolean;
} & (
  | {
      shape: "CUMULATIVE";
      progressPct: number;
      daysRemaining: number | null;
      // Revenue only: the muted collected sub-line under the billed actual.
      collected: number | null;
    }
  | {
      shape: "RATIO";
      percentDifference: number | null;
      priorActual: number | null;
      trend: RatioTrend | null;
    }
);

export function GoalsListPanel({ rows }: { rows: GoalListRow[] }) {
  return (
    <section className="rounded-3xl bg-court-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.10)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-court-brand-dark">
            Goals
          </p>
          <h3 className="mt-1 font-serif text-base font-bold tracking-tight text-court-fg sm:text-lg">
            Active goals
          </h3>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-court-fg-muted">
          No active goals cover this period.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-court-border-soft">
          {rows.map((row) => (
            <GoalRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

function fmt(value: number | null, isMoney: boolean): string {
  if (value === null) return "—";
  return isMoney ? USD.format(Math.round(value)) : String(Math.round(value * 100) / 100);
}

// Ace 68.0 row standard: exactly ONE bold element per row - the metric
// label. Every other cell renders at the regular metadata weight and at
// one metadata size (text-xs), so no two cells in a row disagree on size.
function GoalRow({ row }: { row: GoalListRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-[9rem] flex-1">
        <p className="text-[13px] font-semibold text-court-fg">
          {row.label}
          {row.isMilestone && (
            <span className="ml-2 text-xs font-normal text-court-fg-muted">
              milestone
            </span>
          )}
        </p>
        <p className="text-xs text-court-fg-muted">
          {row.windowLabel}
          {row.ownerName && (
            <>
              {" · "}
              <span className="text-court-fg-muted">{row.ownerName}</span>
            </>
          )}
        </p>
      </div>

      {row.shape === "CUMULATIVE" ? (
        <>
          <div className="w-28 text-xs text-court-fg">
            {fmt(row.actual, row.isMoney)}
            <span className="text-court-fg-muted"> / {fmt(row.target, row.isMoney)}</span>
            {row.collected !== null && (
              <span className="block text-xs text-court-fg-muted">
                {fmt(row.collected, row.isMoney)} collected
              </span>
            )}
            {row.actual === null && row.notTrackedReason && (
              <span className="block text-xs text-court-fg-muted">not tracked yet</span>
            )}
          </div>
          {/* Same track + fill idiom as the Scoreboard funnel and the
              Finances TrendCard: a subtle rounded track with an absolutely
              positioned brand-tint fill grown by width %. */}
          <div className="relative h-2 w-24 overflow-hidden rounded-full bg-court-surface-subtle sm:w-32">
            <div
              className="absolute inset-y-0 left-0 bg-court-brand-tint"
              style={{ width: `${Math.min(100, Math.max(0, row.progressPct))}%` }}
              aria-hidden
            />
          </div>
          {/* A milestone has no period, so it has nothing to be on pace
              against. It gets NO chip rather than an "Unknown" one, which
              would read as a failed measurement instead of a category that
              does not apply. */}
          {row.isMilestone ? (
            <span className="text-xs text-court-fg-muted">no pace window</span>
          ) : (
            <PaceChip status={row.status} />
          )}
          <div className="w-20 text-right text-xs text-court-fg-muted">
            {row.daysRemaining === null ? "—" : `${row.daysRemaining}d left`}
          </div>
        </>
      ) : (
        <>
          <div className="w-28 text-xs text-court-fg">
            {fmt(row.actual, row.isMoney)}
            <span className="text-court-fg-muted"> vs {fmt(row.target, row.isMoney)}</span>
          </div>
          {/* No progress bar and no projection: an average converges rather
              than accumulating, so "percent of target so far" would be a
              meaningless number. */}
          <div className="w-32 text-xs text-court-fg-muted">
            {row.percentDifference === null
              ? "—"
              : `${row.percentDifference >= 0 ? "+" : ""}${row.percentDifference.toFixed(1)}% vs target`}
          </div>
          <div className="inline-flex items-center gap-1 text-xs text-court-fg-muted">
            <TrendArrow trend={row.trend} />
            {row.priorActual === null ? "no prior period" : `${fmt(row.priorActual, row.isMoney)} prior`}
          </div>
          <PaceChip status={row.status} />
        </>
      )}
    </div>
  );
}

// Direction against the prior equivalent period. Never colour alone: the
// arrow always sits next to the prior-period figure in words.
function TrendArrow({ trend }: { trend: RatioTrend | null }) {
  if (trend === "UP") {
    return <ArrowUp className="h-3 w-3 text-court-brand" aria-label="up vs prior period" />;
  }
  if (trend === "DOWN") {
    return <ArrowDown className="h-3 w-3 text-red-600 dark:text-red-400" aria-label="down vs prior period" />;
  }
  if (trend === "FLAT") {
    return <ArrowRight className="h-3 w-3 text-court-fg-muted" aria-label="flat vs prior period" />;
  }
  return null;
}
