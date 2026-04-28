"use client";

import { Moon, Sun } from "lucide-react";
import { useCourtMode, type CourtSurface, type CourtTheme } from "@/lib/court-mode";
import { cn } from "@/lib/utils";

// Two-axis Court Mode picker:
//   Top row  — Light / Dark theme (sun + moon).
//   Surface grid — Hard / Clay / Grass / Night, each rendered as a
//   bordered card with a two-tone vertical swatch on the left and
//   the surface name on the right. Active state lights the card
//   green (border + tint + brighter foreground). Night Court adds
//   a small green dot in the corner of its swatch — visual cue
//   that brand green appears only as accent in that surface.
//
// Picking a surface flips the data-attribute on <html> instantly
// (writes localStorage too); the theme toggle is disabled while
// Night is selected because Night is inherently dark — flipping
// the theme attr is a no-op there and would mislead the recruiter.

type SwatchPair = readonly [string, string];

const SURFACES: Array<{
  id: CourtSurface;
  label: string;
  swatch: SwatchPair;
  // Optional accent dot at the bottom-right of the swatch. Reserved
  // for surfaces whose brand green appears only as an accent (Night
  // is the only one today) so the picker telegraphs the rule.
  accentDot?: string;
}> = [
  { id: "hard",  label: "Hard Court",  swatch: ["#1F4F8B", "#E8EEF5"] },
  { id: "clay",  label: "Clay Court",  swatch: ["#C66B3D", "#FBEEE3"] },
  { id: "grass", label: "Grass Court", swatch: ["#3F7030", "#EAF4E4"] },
  { id: "night", label: "Night Court", swatch: ["#141414", "#1C1C1C"], accentDot: "#7BB85B" },
];

export function CourtModeView() {
  const { surface, theme, setSurface, setTheme, toggleTheme } = useCourtMode();
  const themeLocked = surface === "night";

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Court Mode
      </div>

      {/* Light / Dark toggle — disabled in Night since Night is
          inherently dark. */}
      <div className="flex flex-wrap items-center gap-2">
        <ThemeButton
          active={!themeLocked && theme === "light"}
          disabled={themeLocked}
          onClick={() => !themeLocked && setTheme("light")}
          ariaLabel="Light theme"
          title={themeLocked ? "Night Court is dark only" : "Light theme"}
        >
          <Sun className="h-4 w-4" />
          Light
        </ThemeButton>
        <ThemeButton
          active={!themeLocked && theme === "dark"}
          disabled={themeLocked}
          onClick={() => !themeLocked && setTheme("dark")}
          ariaLabel="Dark theme"
          title={themeLocked ? "Night Court is dark only" : "Dark theme"}
        >
          <Moon className="h-4 w-4" />
          Dark
        </ThemeButton>
        <button
          type="button"
          onClick={() => !themeLocked && toggleTheme()}
          disabled={themeLocked}
          aria-label="Toggle light/dark"
          title={themeLocked ? "Night Court is dark only" : "Toggle light/dark"}
          className={cn(
            "ml-1 rounded-full border border-court-border bg-court-surface-subtle px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg",
            themeLocked && "cursor-not-allowed opacity-40 hover:text-court-fg-muted",
          )}
        >
          ↔
        </button>
      </div>

      {/* Surface grid — three columns with cards that pair a
          two-tone swatch and the surface name. Wraps to a second
          row at the breakpoint, mirroring the reference mock. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((s) => {
          const active = surface === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSurface(s.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                active
                  ? "border-court-accent bg-court-accent-tint ring-2 ring-court-accent/20"
                  : "border-court-border bg-court-surface-subtle hover:bg-court-surface",
              )}
            >
              <div className="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/10">
                <span className="w-1/2" style={{ background: s.swatch[0] }} />
                <span className="w-1/2" style={{ background: s.swatch[1] }} />
                {s.accentDot && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 right-1 h-2 w-2 rounded-full ring-1 ring-black/30"
                    style={{ background: s.accentDot }}
                  />
                )}
              </div>
              <span
                className={cn(
                  "text-sm font-semibold",
                  active ? "text-court-accent-dark" : "text-court-fg",
                )}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-court-fg-muted">
        Persists per browser. Surface + theme combine into the active palette.
      </p>
    </div>
  );
}

function ThemeButton({
  active,
  onClick,
  ariaLabel,
  title,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
        active
          ? "border-court-accent bg-court-accent-tint text-court-accent-dark"
          : "border-court-border bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
        disabled && "cursor-not-allowed opacity-40 hover:text-court-fg-muted",
      )}
    >
      {children}
    </button>
  );
}

// Re-export the type for any settings page bits that reach in for it.
export type { CourtTheme };
