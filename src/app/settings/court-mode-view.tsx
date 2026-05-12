"use client";

import { Moon, Sun } from "lucide-react";
import { useCourtMode, type CourtSurface, type CourtTheme } from "@/lib/court-mode";
import { cn } from "@/lib/utils";

// Two-axis Court Mode picker:
//   Top row  — Light / Dark theme (sun + moon).
//   Surface grid — Hard / Clay / Grass / Night-Light / Night-Dark,
//   each rendered as a bordered card with a mini app-shell mock on
//   the left and the variant name on the right. Active state lights
//   the card green (border + tint + brighter foreground). Night
//   variants carry a small green dot in the corner of the swatch —
//   visual cue that brand green appears only as accent there.
//
// Picking a surface (or Night variant) flips the data-attribute on
// <html> instantly and writes localStorage. Night Light and Night
// Dark share the `night` surface but pin theme to light / dark
// respectively, so clicking them sets both axes in one go.

// Palette mirrors the real --court-* tokens for that (surface, theme)
// pair, pulled directly from globals.css so each preview thumbnail
// looks like the surface actually does. sidebarFg / sidebarMark
// exist because the sidebar can carry a different bg from the main
// area (Grass light is dark green, Clay light is tan), so its text
// and brand-dot need their own contrast-aware values.
type Palette = {
  bg: string;
  sidebar: string;
  sidebarFg: string;
  sidebarMark?: string; // brand dot on sidebar; defaults to `accent`
  fg: string;
  fgMuted: string;
  accent: string;
  border: string;
};

const HARD_LIGHT: Palette = {
  bg: "#FFFFFF",
  sidebar: "#FAFAFB",
  sidebarFg: "#1A2332",
  fg: "#1A2332",
  fgMuted: "#6B7280",
  accent: "#5A9642",
  border: "#E5E7EB",
};
const HARD_DARK: Palette = {
  bg: "#0E1620",
  sidebar: "#16202E",
  sidebarFg: "#F2F5F9",
  fg: "#F2F5F9",
  fgMuted: "#A8B5C8",
  accent: "#4A8FD9",
  border: "#1F2D40",
};
const CLAY_LIGHT: Palette = {
  bg: "#FBF3EC",
  sidebar: "#E8D2BD",
  sidebarFg: "#2A1409",
  fg: "#2A1409",
  fgMuted: "#6B3A20",
  accent: "#B7410E",
  border: "#D6BCA3",
};
const CLAY_DARK: Palette = {
  bg: "#1C1613",
  sidebar: "#2A1B14",
  sidebarFg: "#F8EBDC",
  fg: "#F8EBDC",
  fgMuted: "#D4BFAE",
  accent: "#E89055",
  border: "#402E26",
};
const GRASS_LIGHT: Palette = {
  bg: "#F4F8F1",
  sidebar: "#1F5638",
  sidebarFg: "#FFFFFF",
  // Sidebar bg matches accent in Grass light, so the brand dot needs
  // a lighter green to stay visible.
  sidebarMark: "#7BB85B",
  fg: "#0F2418",
  fgMuted: "#3D5046",
  accent: "#1F5638",
  border: "#D0DCC8",
};
const GRASS_DARK: Palette = {
  bg: "#0C1410",
  sidebar: "#11281C",
  sidebarFg: "#F0F5EE",
  fg: "#F0F5EE",
  fgMuted: "#A8C0B0",
  accent: "#7BB85B",
  border: "#1A3A28",
};
const NIGHT_LIGHT: Palette = {
  bg: "#F6FAF4",
  sidebar: "#0F1A0F",
  sidebarFg: "#FFFFFF",
  // Sidebar slab is near-black, so the brand dot stays vivid green.
  sidebarMark: "#5A9642",
  fg: "#111111",
  fgMuted: "#6B7280",
  accent: "#5A9642",
  border: "#E5E8ED",
};
const NIGHT_DARK: Palette = {
  bg: "#0F1012",
  sidebar: "#18191C",
  sidebarFg: "#F4F5F7",
  fg: "#F4F5F7",
  fgMuted: "#B8BCC2",
  accent: "#7BB85B",
  border: "#23252A",
};

// Each tile is a (surface, [optional pinned theme]) variant. Hard /
// Clay / Grass float on the user's current theme — switching the
// Light/Dark toggle at top swaps their preview. The two Night
// variants pin their theme so the user can pick "Night Light" or
// "Night Dark" directly, without first juggling the theme toggle.
type SurfaceVariant = {
  id: string;
  surface: CourtSurface;
  pinnedTheme?: CourtTheme;
  label: string;
  palettes: { light: Palette; dark: Palette };
  accentDot?: string;
};

const SURFACES: ReadonlyArray<SurfaceVariant> = [
  { id: "hard",  surface: "hard",  label: "Hard Court",  palettes: { light: HARD_LIGHT,  dark: HARD_DARK  } },
  { id: "clay",  surface: "clay",  label: "Clay Court",  palettes: { light: CLAY_LIGHT,  dark: CLAY_DARK  } },
  { id: "grass", surface: "grass", label: "Grass Court", palettes: { light: GRASS_LIGHT, dark: GRASS_DARK } },
  {
    id: "night-light",
    surface: "night",
    pinnedTheme: "light",
    label: "Night Court · Light",
    palettes: { light: NIGHT_LIGHT, dark: NIGHT_LIGHT },
    accentDot: "#5A9642",
  },
  {
    id: "night-dark",
    surface: "night",
    pinnedTheme: "dark",
    label: "Night Court · Dark",
    palettes: { light: NIGHT_DARK, dark: NIGHT_DARK },
    accentDot: "#7BB85B",
  },
];

export function CourtModeView() {
  const { surface, theme, setSurface, setTheme, toggleTheme } = useCourtMode();

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
        Court Mode
      </div>

      {/* Light / Dark toggle. Always interactive — Night Court now
          honors theme too (Night Light + Night Dark are distinct
          tiles below). */}
      <div className="flex flex-wrap items-center gap-2">
        <ThemeButton
          active={theme === "light"}
          onClick={() => setTheme("light")}
          ariaLabel="Light theme"
          title="Light theme"
        >
          <Sun className="h-4 w-4" />
          Light
        </ThemeButton>
        <ThemeButton
          active={theme === "dark"}
          onClick={() => setTheme("dark")}
          ariaLabel="Dark theme"
          title="Dark theme"
        >
          <Moon className="h-4 w-4" />
          Dark
        </ThemeButton>
        <button
          type="button"
          onClick={() => toggleTheme()}
          aria-label="Toggle light/dark"
          title="Toggle light/dark"
          className="ml-1 rounded-full border border-court-border bg-court-surface-subtle px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg"
        >
          ↔
        </button>
      </div>

      {/* Surface grid — mini-app preview tiles. Each tile renders a
          tiny mock of Ace's chrome (sidebar + page area + accent FAB)
          painted in that variant's palette so the recruiter can see
          what they're picking. Active tile lights with court-accent
          border + ring + bottom-bar tint. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {SURFACES.map((s) => {
          // For Night variants the theme is pinned to the tile; for
          // every other surface the preview floats on the current
          // theme toggle so the swatch reflects what the recruiter
          // would actually see.
          const previewTheme: CourtTheme = s.pinnedTheme ?? theme;
          const active =
            surface === s.surface && (s.pinnedTheme ? theme === s.pinnedTheme : true);
          const p = s.palettes[previewTheme];
          const sidebarMark = p.sidebarMark ?? p.accent;
          const handleClick = () => {
            setSurface(s.surface);
            if (s.pinnedTheme) setTheme(s.pinnedTheme);
          };
          return (
            <button
              key={s.id}
              type="button"
              onClick={handleClick}
              aria-pressed={active}
              className={cn(
                "group flex flex-col overflow-hidden rounded-xl border-2 text-left transition",
                active
                  ? "border-court-accent ring-2 ring-court-accent/20"
                  : "border-court-border hover:border-court-fg-muted",
              )}
            >
              <div className="relative h-[110px] w-full" style={{ background: p.bg }}>
                <div
                  className="absolute inset-y-0 left-0 w-[36%] border-r"
                  style={{ background: p.sidebar, borderColor: p.border }}
                >
                  <div className="mt-2.5 ml-2 flex items-center gap-1">
                    <div className="h-2 w-2 rounded-full" style={{ background: sidebarMark }} />
                    <div className="h-1.5 w-7 rounded-sm" style={{ background: p.sidebarFg, opacity: 0.85 }} />
                  </div>
                  <div className="mt-3 ml-2 space-y-1.5">
                    <div className="h-1.5 w-12 rounded-sm" style={{ background: sidebarMark, opacity: 0.85 }} />
                    <div className="h-1.5 w-10 rounded-sm" style={{ background: p.sidebarFg, opacity: 0.35 }} />
                    <div className="h-1.5 w-11 rounded-sm" style={{ background: p.sidebarFg, opacity: 0.35 }} />
                  </div>
                </div>
                <div className="absolute bottom-0 left-[36%] right-0 top-0 p-2.5">
                  <div className="h-2 w-12 rounded-sm" style={{ background: p.fg, opacity: 0.85 }} />
                  <div className="mt-2 h-1.5 w-16 rounded-sm" style={{ background: p.fg, opacity: 0.25 }} />
                  <div className="mt-1 h-1.5 w-10 rounded-sm" style={{ background: p.fg, opacity: 0.25 }} />
                  <div
                    className="absolute bottom-2 right-2 h-5 w-12 rounded-md"
                    style={{ background: p.accent }}
                  />
                </div>
                {s.accentDot && (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 h-2 w-2 rounded-full ring-1 ring-black/30"
                    style={{ background: s.accentDot }}
                  />
                )}
              </div>
              <div
                className={cn(
                  "flex items-center justify-between border-t px-3 py-2.5",
                  active ? "bg-court-accent-tint" : "bg-court-surface",
                )}
                style={{ borderColor: "var(--court-border)" }}
              >
                <span className={cn("text-sm font-semibold", active ? "text-court-accent-dark" : "text-court-fg")}>
                  {s.label}
                </span>
                {active && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-court-accent-dark">
                    Active
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
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
