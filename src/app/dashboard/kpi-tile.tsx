import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

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
  // Live tile carries a soft sage border + sage-tinted shadow so the
  // recruiter can see at a glance which KPIs moved this week. Zeros
  // dim down via court-fg-dim so the eye lands on the non-zero values.
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-court-surface px-3 py-2 transition-shadow",
        live
          ? "border-court-brand/35"
          : "border-court-border shadow-[0_1px_2px_rgba(16,36,24,0.04),0_8px_20px_rgba(16,36,24,0.03)]",
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
        <div className="min-w-0 flex-1 text-[9px] font-extrabold uppercase tracking-[0.1em] text-court-fg-muted">
          {label}
        </div>
      </div>
      <div
        className={cn(
          "mt-1.5 text-center font-serif text-[20px] font-semibold leading-none tracking-[-0.04em] tabular-nums",
          isZero ? "text-court-fg-dim" : "text-court-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}
