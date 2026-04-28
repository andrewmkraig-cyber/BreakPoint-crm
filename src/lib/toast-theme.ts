// Notification toast theme catalog. Three options:
//   • subtle — white card, accent-strip on the left, ink text. Default.
//   • tint   — soft brand-tint background. Quietly distinctive.
//   • ink    — dark surface, light text. Calm; consistent across courts.
//
// Court var values in globals.css are stored as space-separated RGB
// triplets (e.g. `--court-surface: 255 255 255`) so Tailwind alpha-
// value substitution can resolve `bg-court-surface/40` etc. Inline
// styles that consume these vars MUST wrap them in `rgb(...)`, or the
// browser sees the raw triplet string and falls back to its default.
// That's why every court-bound value below is `rgb(var(--court-...))`
// rather than `var(--court-...)`.
//
// `ink` is intentionally not court-bound — it stays the same near-
// black on every court, by design (the "doesn't try to match" option).

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
    bg: "rgb(var(--court-surface))",
    fg: "rgb(var(--court-fg))",
    fgMuted: "rgb(var(--court-fg-muted))",
    border: "rgb(var(--court-border))",
    leftStrip: true,
    accent: "rgb(var(--court-accent))",
    iconBg: "rgb(var(--court-accent-tint))",
    iconFg: "rgb(var(--court-accent-dark))",
    actionBg: "rgb(var(--court-surface-subtle))",
    actionFg: "rgb(var(--court-fg))",
    actionBorder: "rgb(var(--court-border))",
    primaryBg: "rgb(var(--court-accent))",
    primaryFg: "#FFFFFF",
  },
  tint: {
    id: "tint",
    label: "Tint",
    desc: "Soft brand-tint background. Low-key but distinctly Ace.",
    bg: "rgb(var(--court-accent-tint))",
    fg: "rgb(var(--court-fg))",
    fgMuted: "rgb(var(--court-fg-muted))",
    border: "rgb(var(--court-accent))",
    leftStrip: false,
    accent: "rgb(var(--court-accent))",
    iconBg: "rgb(var(--court-surface))",
    iconFg: "rgb(var(--court-accent-dark))",
    actionBg: "rgb(var(--court-surface))",
    actionFg: "rgb(var(--court-fg))",
    actionBorder: "rgb(var(--court-border))",
    primaryBg: "rgb(var(--court-accent))",
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
    accent: "rgb(var(--court-accent))",
    iconBg: "rgba(255,255,255,0.08)",
    iconFg: "rgb(var(--court-accent))",
    actionBg: "rgba(255,255,255,0.10)",
    actionFg: "#F7F5EE",
    actionBorder: "rgba(255,255,255,0.18)",
    primaryBg: "rgb(var(--court-accent))",
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

// Unknown localStorage values (e.g. legacy "ohio-state") fall through
// to subtle silently — no migration script, no console warning.
function readThemeKey(key: string): ToastThemeSpec {
  if (typeof window === "undefined") return TOAST_THEMES[DEFAULT_TOAST_THEME];
  const raw = window.localStorage.getItem(key);
  if (raw && raw in TOAST_THEMES) return TOAST_THEMES[raw as ToastThemeId];
  return TOAST_THEMES[DEFAULT_TOAST_THEME];
}

export function toastBoxShadow(): string {
  return "0 8px 24px -8px rgba(0,0,0,0.18), 0 2px 6px -2px rgba(0,0,0,0.08)";
}

// Backward-compat alias kept so callers that still import the legacy
// name don't break. Both names return the same shadow now — there's no
// per-theme glow anymore.
export const toastGlowBoxShadow = toastBoxShadow;
