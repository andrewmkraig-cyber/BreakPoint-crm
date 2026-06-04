// Google Calendar event color ids. The API can also return this via
// /calendar/v3/colors, but keeping the public defaults here lets the UI render
// rows consistently even before a fresh sync has fetched the color table.
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

type GoogleColorMap = Record<string, { background?: string }>;

export function googleEventColor(
  colorId: string | null | undefined,
  colors?: GoogleColorMap,
): string | null {
  if (!colorId) return null;
  return colors?.[colorId]?.background ?? GOOGLE_EVENT_COLORS[colorId] ?? null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function googleTintStyle(hex: string): Record<string, string> | undefined {
  const normalized = hex.trim().replace(/^#/, "");
  if (!hexToRgb(normalized)) return undefined;
  const color = `#${normalized}`;
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, rgb(var(--court-surface)) 82%)`,
    borderColor: `color-mix(in srgb, ${color} 72%, rgb(var(--court-surface)) 28%)`,
    color: `color-mix(in srgb, ${color} 72%, rgb(var(--court-fg)) 28%)`,
  };
}

export function googleEventColorStyle(
  color: string | null | undefined,
): Record<string, string> | undefined {
  if (!color) return undefined;
  return googleTintStyle(color);
}
