import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

// Semantic button variants. Pick by intent, not color:
//   primary   — create / send / submit / save (the affirming green action)
//   secondary — neutral utility (edit / download / attach / save draft / filters / view toggles)
//   schedule  — calendar / scheduling actions (soft blue)
//   keep      — save-for-later / shortlist / keep-as-warm (soft cyan/teal)
//   apply     — gate-pass / warning style (amber, used for "apply to job" + similar)
//   reject    — destructive / dismiss / delete (soft red)
//   danger    — alias for reject; preserved for back-compat with older call sites
//   ghost     — text-only chrome action (no fill, no border)
//   ai-primary   — Claude / AI affirmative (graphite pill, dark in every Court Mode)
//   ai-secondary — Claude / AI neutral (outlined, sits next to ai-primary as a sibling)
//
// Color resolution: where a Court Mode token exists (court-brand, court-fg
// etc) the variant uses it so the button re-skins across the seven palettes.
// schedule / keep / apply / reject use Tailwind's blue/cyan/amber/red ramps
// because those signals are intentionally outside the brand palette - they
// need to read as their semantic color regardless of which Court the user
// has selected.
type Variant =
  | "primary"
  | "secondary"
  | "schedule"
  | "keep"
  | "apply"
  | "reject"
  | "danger"
  | "ghost"
  | "ai-primary"
  | "ai-secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition rounded-md shadow-sm disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg",
          {
            // Brand green via Court Mode tokens so primary follows
            // whichever Court is active - Grass Light reads brand
            // green, Clay Light reads clay rust, Hard Light reads
            // its slam tone, etc. Hover deepens the wash without
            // jumping shades.
            "border border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/25":
              variant === "primary",
            "bg-court-surface-subtle text-court-fg border border-court-border hover:bg-court-surface":
              variant === "secondary",
            // Soft blue, intentionally outside the brand palette so
            // schedule / calendar actions read distinctly from primary
            // green in every Court Mode.
            "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900 dark:hover:bg-blue-950/60":
              variant === "schedule",
            // Soft cyan/teal for keep / save-for-later / shortlist.
            // Sits between primary green and schedule blue so it reads
            // as a separate intent without crowding either.
            "bg-cyan-50 text-cyan-800 border border-cyan-200 hover:bg-cyan-100 dark:bg-cyan-950/40 dark:text-cyan-200 dark:border-cyan-900 dark:hover:bg-cyan-950/60":
              variant === "keep",
            "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900 dark:hover:bg-amber-950/60":
              variant === "apply",
            // reject + danger collapse to the same red. reject is the
            // preferred name (destructive intent reads as "reject" in
            // recruiting contexts); danger stays as an alias.
            "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900 dark:hover:bg-red-950/60":
              variant === "reject" || variant === "danger",
            "bg-transparent text-court-fg-muted hover:text-court-fg hover:bg-court-surface-subtle":
              variant === "ghost",
            // AI affirmative pill - graphite-leaning dark green that
            // reads as a distinct "Claude" surface in every mode.
            // Light modes paint the deep brand-dark; dark modes lift
            // to a softer graphite so the pill never disappears into
            // the page bg.
            "bg-[#1F3A29] text-white border border-[#2A4D38] hover:bg-[#284A36] dark:bg-[#2D4435] dark:border-[#3A5944] dark:hover:bg-[#37533F]":
              variant === "ai-primary",
            // AI neutral - outlined sibling to ai-primary. Same tone
            // family but sits as the "edit / refine" companion.
            "bg-court-surface text-court-fg border border-court-border hover:border-[#2A4D38] hover:bg-court-surface-subtle dark:hover:border-[#3A5944]":
              variant === "ai-secondary",
          },
          {
            "px-3 py-1.5 text-xs gap-1.5": size === "sm",
            "px-4 py-2 text-sm gap-2": size === "md",
            "px-5 py-2.5 text-sm gap-2": size === "lg",
          },
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
export { Button };
