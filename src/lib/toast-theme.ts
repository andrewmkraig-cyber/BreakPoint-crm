// Notification toast style catalog. Three options:
//
//   • subtle  — white card, accent-strip on the left, ink text. The default.
//   • tint    — soft brand-tint background. Quietly distinctive.
//   • ink     — dark surface, light text. Calm; consistent across courts.
//
// All three bind to court tokens (var(--court-surface), var(--court-fg),
// var(--court-accent), …) so they recolor automatically when the user
// flips Court Mode in Settings — no per-mode duplication.
//
// `ink` is intentionally NOT court-bound on its surface — it stays the
// same near-black on every court, by design (it's the "doesn't try to
// match" option).

export type ToastThemeId = "subtle" | "tint" | "ink";

export type ToastThemeSpec = {
  id: ToastThemeId;
  label: string;
  desc: string;
  bg: string;
  border: string;
  leftStrip: boolean;
  text: string;
  subText: string;
  iconBg: string;
  iconFg: string;
  buttonBg: string;
  buttonBorder: string;
  buttonText: string;
  primaryBg: string;
  primaryText: string;
  accent: string;
};

export const TOAST_THEMES: Record<ToastThemeId, ToastThemeSpec> = {
  subtle: {
    id: "subtle",
    label: "Subtle",
    desc: "White card, colored accent strip, ink text.",
    bg: "var(--court-surface)",
    border: "var(--court-border)",
    leftStrip: true,
    text: "var(--court-fg)",
    subText: "var(--court-fg-muted)",
    iconBg: "var(--court-accent-tint)",
    iconFg: "var(--court-accent-dark)",
    buttonBg: "var(--court-surface-subtle)",
    buttonBorder: "var(--court-border)",
    buttonText: "var(--court-fg)",
    primaryBg: "var(--court-accent)",
    primaryText: "#FFFFFF",
    accent: "var(--court-accent)",
  },
  tint: {
    id: "tint",
    label: "Tint",
    desc: "Soft brand-tint background. Low-key but distinctly Ace.",
    bg: "var(--court-accent-tint)",
    border: "var(--court-accent)",
    leftStrip: false,
    text: "var(--court-fg)",
    subText: "var(--court-fg-muted)",
    iconBg: "var(--court-surface)",
    iconFg: "var(--court-accent-dark)",
    buttonBg: "var(--court-surface)",
    buttonBorder: "var(--court-border)",
    buttonText: "var(--court-fg)",
    primaryBg: "var(--court-accent)",
    primaryText: "#FFFFFF",
    accent: "var(--court-accent)",
  },
  ink: {
    id: "ink",
    label: "Ink",
    desc: "Dark surface, light text. Calm; works on every court.",
    bg: "#1A1A1A",
    border: "#2A2A2A",
    leftStrip: false,
    text: "#F7F5EE",
    subText: "rgba(247, 245, 238, 0.65)",
    iconBg: "rgba(255, 255, 255, 0.08)",
    iconFg: "var(--court-accent)",
    buttonBg: "rgba(255, 255, 255, 0.10)",
    buttonBorder: "rgba(255, 255, 255, 0.18)",
    buttonText: "#F7F5EE",
    primaryBg: "var(--court-accent)",
    primaryText: "#FFFFFF",
    accent: "var(--court-accent)",
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
  return "0 8px 24px -8px rgba(0, 0, 0, 0.18), 0 2px 6px -2px rgba(0, 0, 0, 0.08)";
}
