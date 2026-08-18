import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Our date-ONLY columns (Placement.expectedStartDate / customGuaranteeDate,
// Invoice.startDate / dueDate) are stored as midnight UTC of the chosen day:
// the edit drawers post a "YYYY-MM-DD" string and the server's
// `new Date("2026-08-31")` lands on 2026-08-31T00:00:00Z. Rendering that with
// a plain toLocaleDateString() in a behind-UTC zone (ET) prints the PREVIOUS
// calendar day — /pipeline read 8/30 for a placement whose edit drawer, which
// slices the ISO string in UTC, correctly read 08/31.
//
// True instants (placedAt, lastActionAt, createdAt) must keep rendering in
// local time, and some call sites mix the two — the dashboard drilldown falls
// back to Placement.placedAt when there's no expected start. So we switch on
// the value itself: an exact UTC midnight is a date-only value and formats in
// UTC; anything carrying a time-of-day is a real timestamp and formats local.
function isUtcMidnight(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

export function formatDate(
  value: string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, {
    ...opts,
    ...(isUtcMidnight(d) ? { timeZone: "UTC" } : {}),
  });
}

// US state name → USPS abbreviation. Kept small on purpose — maps the full
// state names RecruiterFlow returns ("Ohio", "New York", etc.) to the 2-letter
// code most recruiters prefer for display.
export const US_STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
  Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
  Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  "District of Columbia": "DC",
};

const US_STATE_NAME_BY_ABBR = Object.fromEntries(
  Object.entries(US_STATE_ABBR).map(([name, abbr]) => [abbr, name]),
) as Record<string, string>;

const COUNTRY_SUFFIXES = new Set([
  "united states",
  "united states of america",
  "usa",
  "us",
  "u.s.",
  "u.s.a.",
  "america",
]);

// Display helper: strips trailing "United States" / "USA" / etc., abbreviates
// full US state names to the 2-letter code, and collapses whitespace. Accepts
// either a free-form string ("Marysville, Ohio, United States") or a
// structured object with city/state/country fields. Returns empty string
// when nothing usable is present.
export function formatLocation(
  raw:
    | string
    | { city?: string | null; state?: string | null; country?: string | null; location?: string | null }
    | null
    | undefined,
): string {
  let city = "";
  let state = "";
  if (raw && typeof raw === "object") {
    city = (raw.city ?? "").trim();
    state = (raw.state ?? "").trim();
    if ((!city || !state) && raw.location) {
      return formatLocationString(raw.location);
    }
    return joinCityState(city, state);
  }
  if (typeof raw === "string") return formatLocationString(raw);
  return "";
}

function formatLocationString(input: string): string {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  // Drop trailing country parts.
  while (parts.length > 0 && COUNTRY_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  if (parts.length === 0) return "";
  // Expected shape: ["City", "State"] — last segment is state, rest joined as city.
  const state = parts.pop()!;
  const city = parts.join(", ");
  return joinCityState(city, state);
}

function joinCityState(city: string, state: string): string {
  const abbr = abbreviateState(state);
  if (city && abbr) return `${city}, ${abbr}`;
  return city || abbr || "";
}

export function abbreviateState(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Already a 2-letter code? Pass through uppercased.
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  // Title-case lookup: "ohio" → "Ohio" → "OH".
  const title = trimmed.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ");
  return US_STATE_ABBR[title] ?? trimmed;
}

export function normalizeUsState(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const abbr = trimmed.toUpperCase();
    return US_STATE_NAME_BY_ABBR[abbr] ? abbr : null;
  }
  const title = trimmed.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ");
  return US_STATE_ABBR[title] ?? null;
}

export function usStateNameForAbbr(raw: string): string | null {
  return US_STATE_NAME_BY_ABBR[raw.trim().toUpperCase()] ?? null;
}
