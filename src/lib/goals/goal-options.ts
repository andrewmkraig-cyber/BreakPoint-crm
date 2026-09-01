// Option lists and period-date defaults for the goal create/edit modal.
//
// PURE ON PURPOSE. The modal is a "use client" component, so nothing it
// imports may reach @/lib/prisma (see scripts/check-client-prisma.mjs and
// the browser-bundle incident it was written for). The enum VALUES are
// restated here as plain string unions rather than imported from
// @prisma/client, so the client bundle never pulls the Prisma package at
// all. The unions are structurally identical to the schema enums, and the
// server actions validate every incoming value against these same lists
// before writing - so a drift between this file and schema.prisma fails
// loudly at the write instead of corrupting a row.

export const GOAL_SCOPES = ["COMPANY", "USER"] as const;
export type GoalScopeValue = (typeof GOAL_SCOPES)[number];

export const GOAL_METRICS = [
  "REVENUE",
  "SIGNED_CLIENTS",
  "PLACEMENTS",
  "SUBMITTALS",
  "INTERVIEWS",
  "BD_CONTACTS_ENROLLED",
  "BD_REPLIES",
  "AVG_DEAL_SIZE",
  "MANUAL",
] as const;
export type GoalMetricValue = (typeof GOAL_METRICS)[number];

export const GOAL_PERIODS = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
  "MILESTONE",
] as const;
export type GoalPeriodValue = (typeof GOAL_PERIODS)[number];

export const GOAL_METRIC_LABELS: Record<GoalMetricValue, string> = {
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

export const GOAL_PERIOD_LABELS: Record<GoalPeriodValue, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
  MILESTONE: "Milestone (all time)",
};

// AVG_DEAL_SIZE is a RATIO goal: an average converges rather than
// accumulating, so it has no rollup parent and no progress-to-target
// reading. The modal hides parent selection for it.
export function isRatioMetric(metric: GoalMetricValue): boolean {
  return metric === "AVG_DEAL_SIZE";
}

// A MILESTONE is cumulative all-time and carries NO period dates - that is
// the one case where periodStart / periodEnd are null in the schema.
export function periodHasDates(period: GoalPeriodValue): boolean {
  return period !== "MILESTONE";
}

// Metrics with no automatic feed. Only MANUAL requires a label, and only
// MANUAL sums GoalActualEntry rows for its actual.
export function metricNeedsManualLabel(metric: GoalMetricValue): boolean {
  return metric === "MANUAL";
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Sensible period bounds for a newly chosen period, as YYYY-MM-DD strings
// for a date input. The user can edit them afterwards.
//
// Dates are CALENDAR-DATE MARKERS, not instants: the goals engine reads
// each bound's UTC calendar date and re-anchors it to ET at query time (see
// etWindow in src/lib/goals/et-window.ts). So "2026-07-01" here means the
// ET day of July 1, whatever the browser's clock says.
export function defaultPeriodDates(
  period: GoalPeriodValue,
  today: Date = new Date(),
): { start: string; end: string } | null {
  if (!periodHasDates(period)) return null;

  // Read the browser's local calendar date. The user is picking a calendar
  // day they can see, not an instant.
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-based
  const d = today.getDate();

  if (period === "DAILY") {
    return { start: iso(y, m + 1, d), end: iso(y, m + 1, d) };
  }
  if (period === "WEEKLY") {
    // Monday through Sunday, matching the ET week the rest of the app uses.
    const dow = new Date(y, m, d).getDay(); // 0 = Sunday
    const backToMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(y, m, d - backToMonday);
    const sunday = new Date(y, m, d - backToMonday + 6);
    return {
      start: iso(monday.getFullYear(), monday.getMonth() + 1, monday.getDate()),
      end: iso(sunday.getFullYear(), sunday.getMonth() + 1, sunday.getDate()),
    };
  }
  if (period === "MONTHLY") {
    const last = new Date(y, m + 1, 0).getDate();
    return { start: iso(y, m + 1, 1), end: iso(y, m + 1, last) };
  }
  if (period === "QUARTERLY") {
    const qStartMonth = Math.floor(m / 3) * 3; // 0, 3, 6, 9
    const last = new Date(y, qStartMonth + 3, 0).getDate();
    return {
      start: iso(y, qStartMonth + 1, 1),
      end: iso(y, qStartMonth + 3, last),
    };
  }
  // ANNUAL
  return { start: iso(y, 1, 1), end: iso(y, 12, 31) };
}
