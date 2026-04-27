"use client";

import { Moon, Sun } from "lucide-react";
import { useCourtMode, type CourtSurface, type CourtTheme } from "@/lib/court-mode";
import { cn } from "@/lib/utils";

// Two-axis Court Mode picker:
//   Top row  — Light / Dark theme (sun + moon).
//   Bottom row — Hard / Clay / Grass surface (with a tennis-court
//   color swatch dot per option).
// Each axis writes independently to localStorage via useCourtMode and
// flips the matching data-attribute on <html> instantly.

const SURFACE_OPTIONS: Array<{
  value: CourtSurface;
  label: string;
  swatchClass: string;
}> = [
  { value: "hard", label: "Hard Court", swatchClass: "bg-[#5A9642]" },
  { value: "clay", label: "Clay Court", swatchClass: "bg-[#C66B3D]" },
  { value: "grass", label: "Grass Court", swatchClass: "bg-[#1F6131]" },
];

export function CourtModeView() {
  const { surface, theme, setSurface, setTheme } = useCourtMode();

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Court Mode
      </div>

      {/* Light / Dark toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <ThemeButton
          active={theme === "light"}
          onClick={() => setTheme("light")}
          ariaLabel="Light theme"
        >
          <Sun className="h-4 w-4" />
          Light
        </ThemeButton>
        <ThemeButton
          active={theme === "dark"}
          onClick={() => setTheme("dark")}
          ariaLabel="Dark theme"
        >
          <Moon className="h-4 w-4" />
          Dark
        </ThemeButton>
      </div>

      {/* Surface selector */}
      <div className="flex flex-wrap items-center gap-2">
        {SURFACE_OPTIONS.map((opt) => {
          const active = surface === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSurface(opt.value)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
                active
                  ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
                  : "border-court-border bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-3 w-3 shrink-0 rounded-full",
                  opt.swatchClass,
                )}
              />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Preserve a hint of where state lives — debugging aid only. */}
      <p className="text-[11px] text-court-fg-muted">
        Persists per browser. Surface + theme combine into 6 palettes.
      </p>
    </div>
  );
}

function ThemeButton({
  active,
  onClick,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
        active
          ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
          : "border-court-border bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
      )}
    >
      {children}
    </button>
  );
}

// Re-export the type for any settings page bits that reach in for it.
export type { CourtTheme };
