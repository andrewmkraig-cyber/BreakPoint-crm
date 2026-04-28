export type ToastThemeId = "subtle" | "tint" | "ink";

export type ToastThemeSpec = {
  id: ToastThemeId;
  label: string;
  desc: string;
  bg: string;
  fg: string;
  fgMuted: string;
  border: string;
  leftStrip: boolean;
  accent: string;
  iconBg: string;
  iconFg: string;
  actionBg: string;
  actionFg: string;
  actionBorder: string;
  primaryBg: string;
  primaryFg: string;
};

export const TOAST_THEMES: Record<ToastThemeId, ToastThemeSpec> = {
  subtle: {
    id: "subtle",
    label: "Subtle",
    desc: "White card, colored accent strip, ink text. Most professional.",
    bg: "var(--court-surface)",
    fg: "var(--court-fg)",
    fgMuted: "var(--court-fg-muted)",
    border: "var(--court-border)",
    leftStrip: true,
    accent: "var(--court-accent)",
    iconBg: "var(--court-accent-tint)",
    iconFg: "var(--court-accent-dark)",
    actionBg: "var(--court-surface-subtle)",
    actionFg: "var(--court-fg)",
    actionBorder: "var(--court-border)",
    primaryBg: "var(--court-accent)",
    primaryFg: "#FFFFFF",
  },
  tint: {
    id: "tint",
    label: "Tint",
    desc: "Soft brand-tint background. Low-key but distinctly Ace.",
    bg: "var(--court-accent-tint)",
    fg: "var(--court-fg)",
    fgMuted: "var(--court-fg-muted)",
    border: "var(--court-accent)",
    leftStrip: false,
    accent: "var(--court-accent)",
    iconBg: "var(--court-surface)",
    iconFg: "var(--court-accent-dark)",
    actionBg: "var(--court-surface)",
    actionFg: "var(--court-fg)",
    actionBorder: "var(--court-border)",
    primaryBg: "var(--court-accent)",
    primaryFg: "#FFFFFF",
  },
  ink: {
    id: "ink",
    label: "Ink",
    desc: "Dark surface, light text. Calm; works on every court.",
    bg: "#1A1A1A",
    fg: "#F7F5EE",
    fgMuted: "rgba(247,245,238,0.65)",
    border: "#2A2A2A",
    leftStrip: false,
    accent: "var(--court-accent)",
    iconBg: "rgba(255,255,255,0.08)",
    iconFg: "var(--court-accent)",
    actionBg: "rgba(255,255,255,0.10)",
    actionFg: "#F7F5EE",
    actionBorder: "rgba(255,255,255,0.18)",
    primaryBg: "var(--court-accent)",
    primaryFg: "#FFFFFF",
  },
};

export const TOAST_THEME_ORDER: ToastThemeId[] = ["subtle", "tint", "ink"];
export const MAIL_TOAST_THEME_KEY = "ace_toast_theme";
export const TEXT_TOAST_THEME_KEY = "ace_text_toast_theme";
export const DEFAULT_TOAST_THEME: ToastThemeId = "subtle";

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

export function toastBoxShadow(): string {
  return "0 8px 24px -8px rgba(0,0,0,.18), 0 2px 6px -2px rgba(0,0,0,.08)";
}

// Alias for backward compat
export const toastGlowBoxShadow = toastBoxShadow;
