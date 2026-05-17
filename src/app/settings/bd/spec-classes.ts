// BD Settings spec primitives. Centralized so every section renders the
// same Save button / number input / toggle-row treatment without 6 forks
// drifting apart on copy-paste. Hex codes in the spec map to Court Mode
// tokens (rule 12) so the styling re-skins across all 8 palettes.

export const BD_SECTION_CARD =
  "rounded-2xl bg-court-surface shadow-sm";

// Outer wrapper for a stack of toggle/edit rows: `divide-y` paints the
// hairline divider between every row. Apply to the container, not the
// rows themselves.
export const BD_ROW_GROUP = "flex flex-col divide-y divide-court-border-soft";

// Single toggle/edit row inside a BD_ROW_GROUP.
export const BD_ROW = "flex items-center justify-between gap-4 py-3";

export const BD_ROW_LABEL = "text-[13px] font-medium text-court-fg";
export const BD_ROW_DESC = "text-[11px] text-court-fg-muted";

export const BD_NUMBER_INPUT =
  "h-10 rounded-xl border border-court-border bg-court-surface px-3 text-[13px] text-court-fg shadow-sm focus:border-court-brand focus:outline-none focus:ring-2 focus:ring-court-brand/10 disabled:opacity-60";

export const BD_TEXT_INPUT = BD_NUMBER_INPUT;

// Pill-style primary save button. Apollo orange-on-tint Save chips were
// replaced with this everywhere so submit affordances feel uniform.
export const BD_SAVE_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-court-brand px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-court-brand-dark disabled:cursor-not-allowed disabled:opacity-50";

export const BD_SECONDARY_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-court-border bg-court-surface px-4 text-[12.5px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:cursor-not-allowed disabled:opacity-50";

// Title chip used by Contact Targeting (Primary / Small-firm fallback /
// Practice-specific). Borderless, brand-tint background, larger padding
// than the previous chip so it reads as a content tag, not a filter.
export const BD_CONTENT_TAG =
  "inline-flex items-center gap-1 rounded-full bg-court-brand-tint px-3 py-1.5 text-[11px] font-medium text-court-fg";

// Domain row status chip. Healthy is brand, warming is amber, cooled
// keeps the red treatment for dead pool slots.
export function bdStatusChipClass(status: "HEALTHY" | "WARMING" | "COOLED") {
  const base =
    "inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-semibold uppercase tracking-wider";
  if (status === "HEALTHY") return `${base} bg-court-brand-tint text-court-brand-dark`;
  if (status === "WARMING") return `${base} bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200`;
  return `${base} bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200`;
}
