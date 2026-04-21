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
            className={cn(
              "flex flex-col items-start gap-2 rounded-xl border bg-white px-4 py-3 text-left shadow-sm transition",
              active
                ? "border-brand ring-2 ring-brand/30"
                : "border-border hover:border-brand/40",
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="font-serif text-sm font-semibold text-navy">{opt.label}</span>
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 rounded-full border border-border/70 shadow-inner"
                style={{ backgroundColor: opt.swatch }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{opt.description}</p>
            <span
              className={cn(
                "mt-1 text-[10px] font-semibold uppercase tracking-wider",
                active ? "text-brand-dark" : "text-muted-foreground",
              )}
            >
              {active ? "Active" : "Select"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
