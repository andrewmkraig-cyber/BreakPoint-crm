// Haversine distance + the pipeline Location-cell sub-line formatter.
// Both consumers (the pipeline view today, anything that needs the same
// "candidate → job" distance string later) call through this file so
// rounding, blank-string semantics, and "(0 miles)" sit in one place.
//
// The job side is resolved via the existing Nominatim geocoder with its
// in-process cache (src/lib/geocode.ts) — never add a second geocoder.
// The candidate side reads Candidate.lat/lng directly (already
// backfilled by scripts/geocode-candidates.ts), so distance computation
// fires zero Nominatim hits when the job's location is already cached.

import { geocodePill, type GeoHit } from "@/lib/geocode";

const EARTH_RADIUS_MILES = 3958.7613;

// Great-circle distance between two lat/lng points in miles, returned as
// a raw float. Callers format with formatMiles() (one decimal + "mi").
// Returns 0 when both points are identical.
export function haversineMiles(
  candidateLat: number,
  candidateLng: number,
  jobLat: number,
  jobLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(jobLat - candidateLat);
  const dLng = toRad(jobLng - candidateLng);
  const lat1 = toRad(candidateLat);
  const lat2 = toRad(jobLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

// Canonical distance sub-line format, shared by BOTH surfaces that show
// a candidate→job distance (the pipeline Location cell and the candidate
// profile job pill): one decimal place + the "mi" abbreviation. Same
// location rounds to "(0.0 mi)". This is the single source of truth for
// the string shape so the two surfaces never drift.
export function formatMiles(miles: number): string {
  return `(${miles.toFixed(1)} mi)`;
}

// Returns the Location-cell sub-line string for one candidate/job pair.
// Blank-cell rule per the spec: if any input is missing or the job's
// location can't be geocoded, return "" so the cell renders fully blank
// (no dash, no "N/A" placeholder). A successful pair always returns
// "(X.X mi)" — same-zip pairs naturally round to "(0.0 mi)".
export async function formatDistanceSubLine(
  candidateLat: number | null,
  candidateLng: number | null,
  jobZip: string | null,
  jobCity: string | null,
  jobState: string | null,
): Promise<string> {
  if (candidateLat == null || candidateLng == null) return "";
  if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLng)) return "";

  // Prefer the zip (5-digit postal codes are unambiguous worldwide);
  // fall back to "City, ST" when zip is missing. If neither has content,
  // we can't ask Nominatim anything — bail blank.
  const zipTrimmed = jobZip?.trim() ?? "";
  const cityStateParts = [jobCity?.trim() ?? "", jobState?.trim() ?? ""].filter(Boolean);
  const query = zipTrimmed || cityStateParts.join(", ");
  if (!query) return "";

  const jobHit: GeoHit | null = await geocodePill(query);
  if (!jobHit) return "";

  const miles = haversineMiles(candidateLat, candidateLng, jobHit.lat, jobHit.lng);
  return formatMiles(miles);
}
