// New-mail toast theme catalog. The Settings picker writes the
// chosen id to localStorage; the toast component reads it at render
// time so a theme swap takes effect on the very next toast (no
// reload, no provider remount).
//
// Themes are kept as raw hex values rather than Tailwind tokens
// because three of them (Ohio State, Cleveland Browns, Dark) live
// outside our brand palette entirely — defining them as inline styles
// keeps them out of the global tailwind theme where they don't
// belong.
//
// IDs use kebab-case so existing localStorage values from earlier
// pickers continue to resolve.

export type ToastThemeId =
  | "breakpoint"
  | "ohio-state"
  | "cleveland-browns"
  | "dark"
  | "yellow"
  | "white";

export type ToastThemeSpec = {
  id: ToastThemeId;
  label: string;
  // Card surface
  bg: string;
  border: string;
  // Box-shadow glow color. `null` = no glow (Dark theme).
  glow: string | null;
  // 40px circular envelope-icon container on the left
  iconCircleBorder: string;
  // Body text
  text: string;
  subText: string;
  // Reply / X chips on the right
  buttonBg: string;
  buttonBorder: string;
};

export const TOAST_THEMES: Record<ToastThemeId, ToastThemeSpec> = {
  breakpoint: {
    id: "breakpoint",
    label: "BreakPoint",
    bg: "#5A9642",
    border: "#5A9642",
    glow: "#5A9642",
    iconCircleBorder: "#EAF4E4",
    text: "#ffffff",
    subText: "#EAF4E4",
    buttonBg: "#3F7030",
    buttonBorder: "#EAF4E4",
  },
  "ohio-state": {
    id: "ohio-state",
    label: "Ohio State",
    bg: "#BB0000",
    border: "#BB0000",
    glow: "#BB0000",
    iconCircleBorder: "#ffffff",
    text: "#ffffff",
    subText: "#ffcccc",
    buttonBg: "#8B0000",
    buttonBorder: "#ffffff",
  },
  "cleveland-browns": {
    id: "cleveland-browns",
    label: "Cleveland Browns",
    bg: "#311D00",
    border: "#FF3C00",
    glow: "#FF3C00",
    iconCircleBorder: "#FF3C00",
    text: "#ffffff",
    subText: "#FF3C00",
    buttonBg: "#311D00",
    buttonBorder: "#FF3C00",
  },
  dark: {
    id: "dark",
    label: "Dark",
    bg: "#1E1E1E",
    border: "#2A2A2A",
    glow: null,
    iconCircleBorder: "#2A2A2A",
    text: "#ffffff",
    subText: "#999999",
    buttonBg: "#2A2A2A",
    buttonBorder: "#444444",
  },
  yellow: {
    id: "yellow",
    label: "Yellow",
    bg: "#FFD400",
    border: "#B8860B",
    glow: "#FFD400",
    iconCircleBorder: "#1A1A1A",
    text: "#1A1A1A",
    subText: "#5C4400",
    buttonBg: "#FFFFFF",
    buttonBorder: "#1A1A1A",
  },
  white: {
    id: "white",
    label: "White",
    bg: "#FFFFFF",
    border: "#E5E5E5",
    glow: null,
    iconCircleBorder: "#1A1A1A",
    text: "#1A1A1A",
    subText: "#6B7280",
    buttonBg: "#F4F4F5",
    buttonBorder: "#1A1A1A",
  },
};

export const TOAST_THEME_ORDER: ToastThemeId[] = [
  "breakpoint",
  "ohio-state",
  "cleveland-browns",
  "dark",
  "yellow",
  "white",
];

export const MAIL_TOAST_THEME_KEY = "ace_toast_theme";
export const TEXT_TOAST_THEME_KEY = "ace_text_toast_theme";
export const DEFAULT_TOAST_THEME: ToastThemeId = "breakpoint";

export function getStoredToastTheme(): ToastThemeSpec {
  return readThemeKey(MAIL_TOAST_THEME_KEY);
}

export function getStoredTextToastTheme(): ToastThemeSpec {
  return readThemeKey(TEXT_TOAST_THEME_KEY);
}

function readThemeKey(key: string): ToastThemeSpec {
  if (typeof window === "undefined") return TOAST_THEMES[DEFAULT_TOAST_THEME];
  const raw = window.localStorage.getItem(key);
  if (raw && raw in TOAST_THEMES) return TOAST_THEMES[raw as ToastThemeId];
  return TOAST_THEMES[DEFAULT_TOAST_THEME];
}

// `0 0 12px 2px <glow @ 30%>` per spec. Returns "none" for themes
// that opted out of a glow.
export function toastGlowBoxShadow(theme: ToastThemeSpec): string {
  if (!theme.glow) return "none";
  return `0 0 12px 2px ${hexToRgba(theme.glow, 0.3)}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
