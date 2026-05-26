import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Canonical KPI tile used across Clubhouse, Scoreboard, and Finances.
// Spec: rounded-2xl bg-court-surface px-3 py-2.5 with the long-shadow
// chrome; label is 10px extrabold uppercase; value is 26px Bricolage
// (font-serif) bold. The optional `live` flag swaps the resting shadow
// for a sage-tinted one so recruiters can see which tiles moved this
// week, without altering label/value size.
//
// Mobile (base) renders as a Jobot/Jax-style card: icon alone top-left,
// value centered, label below value. Desktop (sm+) keeps the original
// icon+label-in-a-row over centered value layout so Finances surfaces
// that share this tile don't shift.
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
        // Mobile (base): no min-height floor + tighter padding so the
        // 2-col card hugs its content. sm+ restores the original 84px /
        // py-2.5 chrome exactly - desktop sizing is untouched.
        "flex h-full min-h-0 flex-col rounded-2xl bg-court-surface px-3 py-2.5 transition-shadow sm:min-h-[84px] sm:py-2.5",
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
      <div className="flex items-center gap-2">
        <div
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-court-brand-tint text-court-brand-dark"
          aria-hidden
        >
          <Icon className="h-3 w-3" />
        </div>
        {/* Desktop: label inline with icon. Hidden on mobile so the icon
            sits alone in the top-left corner per the Jobot card style. */}
        <div className="hidden min-w-0 flex-1 text-[10px] font-extrabold uppercase tracking-wide text-court-fg-muted sm:block">
          {label}
        </div>
      </div>
      <div
        className={cn(
          "mt-2 text-center font-serif text-[26px] font-extrabold leading-none tracking-[-0.04em] tabular-nums sm:mt-1.5",
          isZero ? "text-court-fg-dim" : "text-court-fg",
        )}
      >
        {value}
      </div>
      {/* Mobile-only: label below value in smaller text. Hidden on
          desktop where it lives next to the icon above. */}
      <div className="mt-1 text-center text-[11px] font-semibold text-court-fg-muted sm:hidden">
        {label}
      </div>
    </div>
  );
}
