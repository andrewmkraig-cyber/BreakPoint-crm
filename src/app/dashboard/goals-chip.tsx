import type { PacingStatus } from "@/lib/goals/pacing";

// Pace status chip. Reuses the app's existing chip vocabulary rather than
// inventing one: the same typography as the placements-ledger STATUS_PILL
// (`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide`), the
// brand-outline positive tone that ledger uses for COLLECTED, and its
// slate/red neutral and negative families.
//
// UNKNOWN is the one addition, and it is a TONE not a new style: same
// shape and type, drawn in the muted border + dim text the app already
// uses for empty values, so "we could not measure this" never reads as a
// status. It has to be distinct from ON_PACE, which owns neutral slate.
const CHIP_BASE =
  "inline-flex items-center justify-center whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

const TONE: Record<PacingStatus | "UNKNOWN", string> = {
  AHEAD: "rounded-md border border-court-brand bg-transparent text-court-brand",
  ON_PACE:
    "rounded-full bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:border-slate-700",
  BEHIND:
    "rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
  // text-court-fg-muted, NOT fg-dim. Measured in Chrome across all eight
  // Court combinations: fg-dim bottoms out at 2.54:1 on hard/light and
  // night/light, below the 4.5:1 AA floor for text; fg-muted holds 4.83:1
  // at its worst. The chip still reads quieter than the others because it
  // is the only one with no fill.
  UNKNOWN: "rounded-full border border-court-border bg-transparent text-court-fg-muted",
};

const LABEL: Record<PacingStatus | "UNKNOWN", string> = {
  AHEAD: "Ahead",
  ON_PACE: "On pace",
  BEHIND: "Behind",
  UNKNOWN: "Unknown",
};

export function PaceChip({ status }: { status: PacingStatus | null }) {
  const key = status ?? "UNKNOWN";
  return <span className={`${CHIP_BASE} ${TONE[key]}`}>{LABEL[key]}</span>;
}

export function paceStatusLabel(status: PacingStatus | null): string {
  return LABEL[status ?? "UNKNOWN"];
}
