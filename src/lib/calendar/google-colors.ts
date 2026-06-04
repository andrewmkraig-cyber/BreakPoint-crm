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

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return `#${[r, g, b]
    .map((n) =>
      Math.round(Math.max(0, Math.min(255, n)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function mixRgb(
  base: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  amount: number,
): { r: number; g: number; b: number } {
  return {
    r: base.r + (target.r - base.r) * amount,
    g: base.g + (target.g - base.g) * amount,
    b: base.b + (target.b - base.b) * amount,
  };
}

function googleTintStyle(hex: string): Record<string, string> | undefined {
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  return {
    backgroundColor: rgbToHex(mixRgb(rgb, white, 0.82)),
    borderColor: rgbToHex(mixRgb(rgb, white, 0.18)),
    color: rgbToHex(mixRgb(rgb, black, 0.42)),
  };
}

export function googleEventColorStyle(
  color: string | null | undefined,
): Record<string, string> | undefined {
  if (!color) return undefined;
  return googleTintStyle(color);
}
