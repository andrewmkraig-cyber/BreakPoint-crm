// Shared Nominatim geocoder + in-process cache. Lifted out of
// src/app/api/candidates/search/route.ts (Ace 68.x) so the pipeline
// SSR distance helper can reuse the same cache without spawning a
// second geocoder. The candidate-search route still imports geocodePill
// from here, so the (key, hit) cache stays one Map per server process.
//
// Behavior is identical to the prior in-route implementation:
// - 5-digit numeric strings hit the dedicated postalcode endpoint first,
//   then fall back to the freeform q= path.
// - 5s AbortSignal timeout per Nominatim hit.
// - Module-level Map cache; null hits are also cached so we don't re-ask
//   Nominatim for the same un-geocodable string twice in one process.

export type GeoHit = { lat: number; lng: number };

type NominatimHit = { lat: string; lon: string };

// Nominatim usage policy requires a descriptive User-Agent so they can
// reach us if the rate looks abusive. Email matches the maintainer.
const NOMINATIM_UA =
  "Ace-BreakPointTalent-Search/1.0 (andrew@breakpointtalent.com)";

// Module-level cache. Next's serverless runtime recycles the process
// often enough that cache freshness isn't a concern (city centroids
// don't move). Null entries are cached too — they signal "Nominatim has
// no fix for this string" so a repeat call is a no-op.
export const geocodeCache = new Map<string, GeoHit | null>();

export async function fetchNominatim(url: string): Promise<GeoHit | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA },
      // 5s upper bound so a slow Nominatim doesn't stall the caller —
      // every consumer falls back to a degraded path on null return.
      signal: AbortSignal.timeout(5000),
    });
    // Nominatim's published usage policy is one request per second;
    // a burst on a cold pipeline render (many distinct job locations)
    // can earn a 429. Treat it the same way we treat un-geocodable
    // input: silently return null so geocodePill caches the null and
    // the caller's distance sub-line renders fully blank. No console
    // noise, no thrown error — the Location cell stays clean and the
    // next warm process will pick up the cached miss without re-asking.
    if (res.status === 429) return null;
    if (!res.ok) return null;
    const arr = (await res.json()) as NominatimHit[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = Number.parseFloat(arr[0].lat);
    const lng = Number.parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function geocodePill(loc: string): Promise<GeoHit | null> {
  const key = loc.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  // 5-digit numeric strings are US ZIP codes — the freeform `q=` path
  // resolves them inconsistently (Nominatim sometimes returns the ZIP
  // boundary's POI cluster instead of the centroid, sometimes nothing).
  // Hit the dedicated postalcode endpoint first; only fall back to the
  // freeform text path when the postalcode lookup returns nothing.
  if (/^\d{5}$/.test(key)) {
    const zipUrl = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(key)}&country=us&format=json&limit=1`;
    const zipHit = await fetchNominatim(zipUrl);
    if (zipHit) {
      geocodeCache.set(key, zipHit);
      return zipHit;
    }
  }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc)}&format=json&limit=1`;
  const hit = await fetchNominatim(url);
  geocodeCache.set(key, hit);
  return hit;
}
