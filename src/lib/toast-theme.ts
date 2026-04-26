// New-mail toast theme catalog. The Settings picker writes the
// chosen id to localStorage; the toast component reads it at render
// time so a theme swap takes effect on the very next toast (no
// reload, no provider remount).
//
// Themes are kept as plain hex values rather than Tailwind tokens
// because two of them (Ohio State, Cleveland Browns) live outside
// our brand palette entirely — defining them as inline styles keeps
// them out of the global tailwind theme where they don't belong.

export type ToastThemeId =
  | "breakpoint"
  | "dark"
  | "ohio-state"
  | "cleveland-browns"
  | "classic";

export type ToastThemeSpec = {
  id: ToastThemeId;
  label: string;
  bg: string;
  text: string;
  // Subdued text used for the subject line. Defaults to the same as
  // text with a touch of opacity at the call site if not set.
  subText?: string;
  border?: string;
  // Action chips inside the toast (Reply, X). On dark themes these
  // need to be light so they're legible; on the Classic theme the
  // text stays dark.
  actionBg: string;
  actionText: string;
  actionBorder: string;
};

export const TOAST_THEMES: Record<ToastThemeId, ToastThemeSpec> = {
  breakpoint: {
    id: "breakpoint",
    label: "BreakPoint",
    bg: "#5A9642",
    text: "#ffffff",
    subText: "rgba(255,255,255,0.85)",
    actionBg: "rgba(255,255,255,0.12)",
    actionText: "#ffffff",
    actionBorder: "rgba(255,255,255,0.35)",
  },
  dark: {
    id: "dark",
    label: "Dark",
    bg: "#1a1a1a",
    text: "#ffffff",
    subText: "rgba(255,255,255,0.78)",
    actionBg: "rgba(255,255,255,0.10)",
    actionText: "#ffffff",
    actionBorder: "rgba(255,255,255,0.30)",
  },
  "ohio-state": {
    id: "ohio-state",
    label: "Ohio State",
    bg: "#BB0000",
    text: "#ffffff",
    subText: "rgba(255,255,255,0.85)",
    actionBg: "#666666",
    actionText: "#ffffff",
    actionBorder: "#666666",
  },
  "cleveland-browns": {
    id: "cleveland-browns",
    label: "Cleveland Browns",
    bg: "#FF3C00",
    text: "#ffffff",
    subText: "rgba(255,255,255,0.9)",
    actionBg: "#311D00",
    actionText: "#ffffff",
    actionBorder: "#311D00",
  },
  classic: {
    id: "classic",
    label: "Classic",
    bg: "#ffffff",
    text: "#111111",
    subText: "rgba(17,17,17,0.65)",
    border: "1px solid #e5e5e5",
    actionBg: "#ffffff",
    actionText: "#111111",
    actionBorder: "#e5e5e5",
  },
};

export const TOAST_THEME_ORDER: ToastThemeId[] = [
  "breakpoint",
  "dark",
  "ohio-state",
  "cleveland-browns",
  "classic",
];

export const MAIL_TOAST_THEME_KEY = "ace_toast_theme";
export const DEFAULT_TOAST_THEME: ToastThemeId = "breakpoint";

export function getStoredToastTheme(): ToastThemeSpec {
  if (typeof window === "undefined") return TOAST_THEMES[DEFAULT_TOAST_THEME];
  const raw = window.localStorage.getItem(MAIL_TOAST_THEME_KEY);
  if (raw && raw in TOAST_THEMES) return TOAST_THEMES[raw as ToastThemeId];
  return TOAST_THEMES[DEFAULT_TOAST_THEME];
}
