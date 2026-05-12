import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

// Semantic button variants. Pick by intent, not color:
//   primary   — Submit / send / save (the affirming green action)
//   secondary — neutral utility (Add Note / Add to List / filters /
//               view toggles / download / attach)
//   schedule  — Schedule Interview (soft blue, calendar-tinted)
//   keep      — Keep / save-for-later (soft light blue, a hair lighter
//               than schedule so the two intents sit beside each other)
//   apply     — Apply to Job (amber, the recruiter's "candidate is now in
//               the pipeline" gate-pass; intentionally NOT primary green
//               so Submit stays the only affirmative-green action)
//   client-invite — "Client Sending Invite" / tracking-only flows
//               (slate greyish-blue). Distinct from `secondary`
//               because `secondary` picks up court-mode tinting in
//               Grass Light and reads almost-green next to Submit;
//               distinct from `schedule` because Schedule Interview
//               sits beside it on the same row and the two intents
//               need to read as different colour families.
//   reject    — Reject / destructive / delete (soft red)
//   danger    — alias for reject; preserved for back-compat with older call sites
//   reapply   — Reapply a disqualified candidate (soft violet). Cooler than
//               the offer-stage purple so the two intents don't blur, and
//               clearly distinct from reject red so the inverse action
//               reads as a different intent at a glance.
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
  | "client-invite"
  | "reject"
  | "danger"
  | "reapply"
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
            // Soft light blue. schedule + keep collapse to the same
            // wash — both are calendar/pipeline-adjacent intents that
            // Andrew wants reading as the same colour family,
            // intentionally outside the brand palette so they stay
            // distinct from primary green in every Court Mode.
            "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900 dark:hover:bg-blue-950/60":
              variant === "schedule" || variant === "keep",
            "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900 dark:hover:bg-amber-950/60":
              variant === "apply",
            // Slate greyish-blue. Sits beside schedule (light blue)
            // and primary (green) on the candidate-profile job
            // strip — slate is cool but neutral enough to read as
            // its own intent without competing with either neighbor.
            "bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800":
              variant === "client-invite",
            // reject + danger collapse to the same red. reject is the
            // preferred name (destructive intent reads as "reject" in
            // recruiting contexts); danger stays as an alias.
            "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900 dark:hover:bg-red-950/60":
              variant === "reject" || variant === "danger",
            "bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900 dark:hover:bg-violet-950/60":
              variant === "reapply",
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

// Single source of truth for the Claude / AI affirmative pill across
// Ace. Every "Generate with Claude" / "Find Matches" / "Summarize with
// Claude" / "Parse with Claude" affordance imports this so the pill
// renders identically wherever it lands. Use directly on a <button>:
//
//   import { CLAUDE_PILL_CLASS } from "@/components/ui/button";
//   <button className={CLAUDE_PILL_CLASS}>Generate with Claude</button>
//
// Compose with cn() when a caller needs extra modifiers (e.g. w-full):
//   <button className={cn(CLAUDE_PILL_CLASS, "w-full justify-center")} />
//
// Mirrors the ai-primary Button variant's color tokens but bakes in the
// canonical px-3 py-2 text-xs gap-1.5 sizing so every Claude pill across
// the app reads as the same height + padding without each caller having
// to pick the same `size` prop.
export const CLAUDE_PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-[#2A4D38] bg-[#1F3A29] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#284A36] dark:border-[#3A5944] dark:bg-[#2D4435] dark:hover:bg-[#37533F] focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-court-bg disabled:cursor-not-allowed disabled:opacity-60";

// Canonical "Add to List" affordance. Matches the candidate profile's
// neutral-white surface so every Add to List across the app — candidate
// profile, /candidates bulk bar, Matches bulk bar — renders identically.
// Bake the shape in (rounded-md, square corners) so it doesn't drift
// to a pill on any surface.
export const ADD_TO_LIST_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-xs font-medium text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark disabled:cursor-not-allowed disabled:opacity-60";
