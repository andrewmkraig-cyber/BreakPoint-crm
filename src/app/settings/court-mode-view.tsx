"use client";

import { useCourtMode, type CourtMode } from "@/lib/court-mode";
import { cn } from "@/lib/utils";

type Option = {
  value: CourtMode;
  label: string;
  description: string;
  swatch: string;
};

// Three fixed options — the vocabulary is deliberately tennis-themed; the
// internal names (hard/clay/grass) are the storage values the provider
// already knows about. Swatch colors here are cosmetic only (rendered dots
// in the radio card) — the actual palette lives in tailwind.config and
// component-level dark:/grass: variants that will land surface-by-surface.
const OPTIONS: Option[] = [
  {
    value: "hard",
    label: "Hard Court",
    description: "Default palette — white backgrounds, navy text.",
    swatch: "#FFFFFF",
  },
  {
    value: "clay",
    label: "Clay Court",
    description: "Dark mode — slate backgrounds, light text.",
    swatch: "#1E293B",
  },
  {
    value: "grass",
    label: "Grass Court",
    description: "Green palette — BreakPoint greens everywhere.",
    swatch: "#1A2E1A",
  },
];

export function CourtModeView() {
  const { mode, setMode } = useCourtMode();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setMode(opt.value)}
            aria-pressed={active}
            // Both active and inactive carry `border-2` so selecting a card
            // doesn't shift the grid by 1px as the border widens; the
            // difference is color + background tint, not thickness.
            className={cn(
              "flex flex-col items-start gap-2 rounded-xl border-2 px-4 py-3 text-left shadow-sm transition",
              active
                ? "border-court-accent bg-court-accent-tint"
                : "border-court-border bg-court-surface hover:border-court-accent/40",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="font-serif text-sm font-semibold text-court-fg">{opt.label}</span>
              {/* Swatch color is a fixed preview of the three modes, so it
                  intentionally stays on inline hex regardless of the active
                  theme — that's the whole point of a preview tile. */}
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-full border border-court-border/70 shadow-inner"
                style={{ backgroundColor: opt.swatch }}
              />
            </div>
            <p className="text-xs text-court-fg-muted">{opt.description}</p>
            <span
              className={cn(
                "mt-1 text-[10px] uppercase tracking-wider",
                // ACTIVE goes bold + mode-aware accent green. In Hard that
                // renders as the brand-dark (#3F7030); Clay lifts to
                // #8BC069; Grass lifts further to #B7D6A0 so it stays
                // readable on the dark-green tint background.
                active
                  ? "font-bold text-court-accent-dark"
                  : "font-semibold text-court-fg-muted",
              )}
            >
              {active ? "ACTIVE" : "Select"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
