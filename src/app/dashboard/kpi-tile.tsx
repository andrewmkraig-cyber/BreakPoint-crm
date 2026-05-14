import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Canonical KPI tile used across Clubhouse, Scoreboard, and Finances.
// Spec: rounded-2xl bg-court-surface px-3 py-2.5 with the long-shadow
// chrome; label is 10px extrabold uppercase; value is 26px Bricolage
// (font-serif) bold. The optional `live` flag swaps the resting shadow
// for a sage-tinted one so recruiters can see which tiles moved this
// week, without altering label/value size.
export function KpiTile({
  label,
  value,
  icon: Icon,
  live = false,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  live?: boolean;
}) {
  const isZero = value === 0 || value === "0";
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl bg-court-surface px-3 py-2.5 transition-shadow",
        live
          ? "border border-court-brand/35"
          : "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_rgba(0,0,0,0.06)]",
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
      <div className="flex items-center gap-2">
        <div
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-court-brand-tint text-court-brand-dark"
          aria-hidden
        >
          <Icon className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted">
          {label}
        </div>
      </div>
      <div
        className={cn(
          "mt-1.5 text-center font-serif text-[26px] font-bold leading-none tracking-[-0.04em] tabular-nums",
          isZero ? "text-court-fg-dim" : "text-court-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}
