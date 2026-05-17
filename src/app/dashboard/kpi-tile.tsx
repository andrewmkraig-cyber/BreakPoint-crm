import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Canonical KPI tile used across Clubhouse, Scoreboard, Placements,
// and Finances. Optional icon shows the tinted square chrome when
// passed; optional subtext renders below the value for context
// (period, count, hint). The `live` flag swaps the resting shadow
// for a sage-tinted one so recruiters can see which tiles moved
// this week; `zeroDim` dims the value when it represents "no data".
export function KpiTile({
  label,
  value,
  icon: Icon,
  subtext,
  live = false,
  zeroDim = false,
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  subtext?: string;
  live?: boolean;
  zeroDim?: boolean;
}) {
  // "Empty" covers literal zero plus the formatted-zero strings we
  // produce across surfaces: "$0", "0%", "0.0%", "0d", and the "—"
  // placeholder used when underlying data is null. Keep this list in
  // sync with formatters in scoreboard/finances tabs so zeroDim
  // matches the prior per-surface isEmpty checks.
  const isEmpty =
    value === 0 ||
    value === "0" ||
    value === "—" ||
    (typeof value === "string" && /^\$?0(\.0+)?[%d]?$/.test(value));
  const dim = zeroDim && isEmpty;
  return (
    <div
      className={cn(
        "flex h-full min-h-[84px] flex-col rounded-2xl bg-court-surface px-3 py-2.5 transition-shadow",
        live
          ? "border border-court-brand/35"
          : "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.08)]",
      )}
      style={
        live
          ? {
              boxShadow:
                "0 1px 2px rgb(var(--court-brand) / 0.06), 0 8px 18px rgb(var(--court-brand) / 0.08)",
            }
          : undefined
      }
    >
      <div className="flex min-h-[32px] items-center gap-2">
        {Icon && (
          <div
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-court-brand-tint text-court-brand-dark"
            aria-hidden
          >
            <Icon className="h-3 w-3" />
          </div>
        )}
        <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
          {label}
        </div>
      </div>
      <div
        className={cn(
          "mt-1.5 text-center font-serif text-[26px] leading-none tracking-[-0.04em] tabular-nums",
          dim
            ? "font-semibold text-court-border opacity-50"
            : "font-bold text-court-fg",
        )}
      >
        {value}
      </div>
      {subtext && (
        <div className="mt-1 text-center text-[11px] text-court-fg-muted">
          {subtext}
        </div>
      )}
    </div>
  );
}
