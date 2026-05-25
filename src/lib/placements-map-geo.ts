import type {
  PlacementsDashboardBillingStatus,
  PlacementsDashboardRow,
} from "@/lib/placements-dashboard";

// Static city coordinate lookup. Equirectangular lng/lat. Kept local —
// the placement map renders entirely from this table; we never call a
// geocoder at render time. Cities not in this list are dropped from
// the map (see aggregateByCity) rather than pinned to a fallback —
// a wrong-place pin reads as a real datapoint and would mislead.
export type CityCoord = { lng: number; lat: number };

export const CITY_COORDS: ReadonlyMap<string, CityCoord> = new Map([
  ["Atlanta, GA", { lng: -84.39, lat: 33.75 }],
  ["Austin, TX", { lng: -97.74, lat: 30.27 }],
  ["Baltimore, MD", { lng: -76.61, lat: 39.29 }],
  ["Beachwood, OH", { lng: -81.5085, lat: 41.4645 }],
  ["Birmingham, AL", { lng: -86.81, lat: 33.52 }],
  ["Boston, MA", { lng: -71.06, lat: 42.36 }],
  ["Buffalo, NY", { lng: -78.88, lat: 42.89 }],
  ["Charleston, SC", { lng: -79.93, lat: 32.78 }],
  ["Charlotte, NC", { lng: -80.84, lat: 35.23 }],
  ["Chicago, IL", { lng: -87.63, lat: 41.88 }],
  ["Cincinnati, OH", { lng: -84.512, lat: 39.1031 }],
  ["Cleveland, OH", { lng: -81.6944, lat: 41.4993 }],
  ["Columbus, OH", { lng: -82.9988, lat: 39.9612 }],
  ["Dallas, TX", { lng: -96.8, lat: 32.78 }],
  ["Denver, CO", { lng: -104.99, lat: 39.74 }],
  ["Des Moines, IA", { lng: -93.62, lat: 41.59 }],
  ["Detroit, MI", { lng: -83.05, lat: 42.33 }],
  ["Fort Worth, TX", { lng: -97.33, lat: 32.76 }],
  ["Hartford, CT", { lng: -72.69, lat: 41.76 }],
  ["Houston, TX", { lng: -95.37, lat: 29.76 }],
  ["Independence, OH", { lng: -81.639, lat: 41.3978 }],
  ["Indianapolis, IN", { lng: -86.16, lat: 39.77 }],
  ["Jacksonville, FL", { lng: -81.66, lat: 30.33 }],
  ["Kansas City, MO", { lng: -94.58, lat: 39.1 }],
  ["Las Vegas, NV", { lng: -115.14, lat: 36.17 }],
  ["Los Angeles, CA", { lng: -118.24, lat: 34.05 }],
  ["Louisville, KY", { lng: -85.76, lat: 38.25 }],
  ["Memphis, TN", { lng: -90.05, lat: 35.15 }],
  ["Miami, FL", { lng: -80.19, lat: 25.76 }],
  ["Milwaukee, WI", { lng: -87.91, lat: 43.04 }],
  ["Minneapolis, MN", { lng: -93.27, lat: 44.98 }],
  ["Nashville, TN", { lng: -86.78, lat: 36.16 }],
  ["New Orleans, LA", { lng: -90.07, lat: 29.95 }],
  ["New York, NY", { lng: -74.01, lat: 40.71 }],
  ["Newark, NJ", { lng: -74.17, lat: 40.74 }],
  ["Oklahoma City, OK", { lng: -97.52, lat: 35.47 }],
  ["Omaha, NE", { lng: -95.93, lat: 41.26 }],
  ["Orlando, FL", { lng: -81.38, lat: 28.54 }],
  ["Philadelphia, PA", { lng: -75.16, lat: 39.95 }],
  ["Phoenix, AZ", { lng: -112.07, lat: 33.45 }],
  ["Pittsburgh, PA", { lng: -79.9959, lat: 40.4406 }],
  ["Portland, OR", { lng: -122.68, lat: 45.52 }],
  ["Providence, RI", { lng: -71.41, lat: 41.82 }],
  ["Raleigh, NC", { lng: -78.64, lat: 35.78 }],
  ["Richmond, VA", { lng: -77.44, lat: 37.54 }],
  ["Sacramento, CA", { lng: -121.49, lat: 38.58 }],
  ["Salt Lake City, UT", { lng: -111.89, lat: 40.76 }],
  ["San Antonio, TX", { lng: -98.49, lat: 29.42 }],
  ["San Diego, CA", { lng: -117.16, lat: 32.72 }],
  ["San Francisco, CA", { lng: -122.42, lat: 37.77 }],
  ["San Jose, CA", { lng: -121.89, lat: 37.34 }],
  ["Seattle, WA", { lng: -122.33, lat: 47.61 }],
  ["Solon, OH", { lng: -81.4412, lat: 41.3897 }],
  ["St. Louis, MO", { lng: -90.2, lat: 38.63 }],
  ["Tampa, FL", { lng: -82.46, lat: 27.95 }],
  ["Tucson, AZ", { lng: -110.93, lat: 32.22 }],
  ["Washington, DC", { lng: -77.04, lat: 38.91 }],
]);

export type CityAggregate = {
  city: string;
  // Normalized lookup key — "atlanta, ga" etc. Used for hover sync
  // between the list and the map without worrying about user-entered
  // casing/whitespace mismatches.
  key: string;
  count: number;
  totalFee: number;
  leadClient: string | null;
  statusMix: Record<PlacementsDashboardBillingStatus, number>;
  // Null when the city isn't in CITY_COORDS — the row still appears in
  // the Revenue by City list but the map filters it out so we don't
  // pin to a fallback centroid (a wrong-place pin reads as real data).
  lat: number | null;
  lng: number | null;
};

function normalizeKey(city: string): string {
  return city.trim().toLowerCase();
}

// Strip the ", ST" suffix so a placement row stored as just "Pittsburgh"
// can still match the CITY_COORDS entry keyed "Pittsburgh, PA" (and the
// other way around). Client.location.city ships without the state in
// most rows, so we look up under both shapes.
function cityOnly(normalized: string): string {
  const idx = normalized.indexOf(",");
  return idx >= 0 ? normalized.slice(0, idx).trim() : normalized;
}

export function aggregateByCity(rows: PlacementsDashboardRow[]): CityAggregate[] {
  const buckets = new Map<
    string,
    {
      city: string;
      key: string;
      count: number;
      totalFee: number;
      clientFees: Map<string, number>;
      statusMix: Record<PlacementsDashboardBillingStatus, number>;
    }
  >();

  for (const row of rows) {
    const cityRaw = row.city?.trim();
    if (!cityRaw) continue;
    const key = normalizeKey(cityRaw);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        city: cityRaw,
        key,
        count: 0,
        totalFee: 0,
        clientFees: new Map(),
        statusMix: { COLLECTED: 0, BILLED: 0, PENDING_START: 0, OVERDUE: 0 },
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const fee = row.feeAmount && row.feeAmount > 0 ? row.feeAmount : 0;
    bucket.totalFee += fee;
    bucket.statusMix[row.billingStatus] += 1;
    if (row.clientName) {
      bucket.clientFees.set(
        row.clientName,
        (bucket.clientFees.get(row.clientName) ?? 0) + fee,
      );
    }
  }

  // Match city strings against the static lookup case-insensitively so
  // "atlanta, ga" / "Atlanta, GA" / "ATLANTA, GA" all hit the same dot.
  // Also register a city-only alias ("pittsburgh") for every "City, ST"
  // entry so placements stored without a state still resolve.
  const coordIndex = new Map<string, CityCoord>();
  CITY_COORDS.forEach((coord, name) => {
    const full = normalizeKey(name);
    coordIndex.set(full, coord);
    const cityKey = cityOnly(full);
    if (cityKey !== full && !coordIndex.has(cityKey)) {
      coordIndex.set(cityKey, coord);
    }
  });

  const aggregates: CityAggregate[] = [];
  buckets.forEach((bucket) => {
    const coord =
      coordIndex.get(bucket.key) ?? coordIndex.get(cityOnly(bucket.key));
    // Cities with no coord match are kept in the aggregate (so they
    // appear in the Revenue by City list) but carry null lat/lng — the
    // leaflet map filters those out at render time rather than pinning
    // to a fallback centroid.
    let leadClient: string | null = null;
    let leadFee = -1;
    bucket.clientFees.forEach((fee, name) => {
      if (fee > leadFee) {
        leadClient = name;
        leadFee = fee;
      }
    });
    aggregates.push({
      city: bucket.city,
      key: bucket.key,
      count: bucket.count,
      totalFee: bucket.totalFee,
      leadClient,
      statusMix: bucket.statusMix,
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
    });
  });

  aggregates.sort((a, b) => b.totalFee - a.totalFee || b.count - a.count);
  return aggregates;
}

// One decimal place when not a round thousand/million; integer otherwise.
// $7,500 → $7.5K, $12,500 → $12.5K, $150,000 → $150K, $1.2M → $1.2M.
export function formatMoneyShort(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = Math.round((abs / 1_000_000) * 10) / 10;
    return `${sign}$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const k = Math.round((abs / 1_000) * 10) / 10;
    return `${sign}$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `${sign}$${Math.round(abs)}`;
}

export const STATUS_COLORS: Record<PlacementsDashboardBillingStatus, string> = {
  COLLECTED: "#3F7030",
  BILLED: "#1E40AF",
  PENDING_START: "#92400E",
  OVERDUE: "#B91C1C",
};

export const STATUS_LABELS: Record<PlacementsDashboardBillingStatus, string> = {
  COLLECTED: "Paid",
  BILLED: "Billed",
  PENDING_START: "Pending start",
  OVERDUE: "Overdue",
};

// Bubble sizing: clamp radius between 4 and 10 px. Scale linearly off
// total fees so the visual weight tracks dollar value, not just count.
// Empty/zero-fee buckets still get the floor radius so a placement
// without a fee captured still surfaces visibly.
export function bubbleRadius(totalFee: number, maxFee: number): number {
  const MIN = 4;
  const MAX = 10;
  if (maxFee <= 0) return MIN;
  const ratio = Math.min(1, Math.max(0, totalFee / maxFee));
  return MIN + ratio * (MAX - MIN);
}

export function dominantStatus(
  statusMix: Record<PlacementsDashboardBillingStatus, number>,
): PlacementsDashboardBillingStatus {
  // Tiebreak with a stable priority order so the border color is
  // deterministic when counts tie (Overdue > Billed > Pending > Collected).
  const order: PlacementsDashboardBillingStatus[] = [
    "OVERDUE",
    "BILLED",
    "PENDING_START",
    "COLLECTED",
  ];
  let bestStatus: PlacementsDashboardBillingStatus = "COLLECTED";
  let bestCount = -1;
  for (const s of order) {
    if (statusMix[s] > bestCount) {
      bestCount = statusMix[s];
      bestStatus = s;
    }
  }
  return bestStatus;
}
