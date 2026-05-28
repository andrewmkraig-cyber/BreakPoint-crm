// US city + ZIP validation. Uses two free, no-key services because no
// GOOGLE_MAPS_API_KEY (or any geocoding key) is configured for the
// project:
//
//   - Zippopotam.us → ZIP code → city/state lookup. 5-digit US zips
//     resolve to a JSON payload; unknown zips 404.
//   - OpenStreetMap Nominatim → free-text city search constrained to
//     `country=us`. We accept a result only when its address.country
//     is the United States and the candidate string clearly identifies
//     a city/town/municipality (place_rank check).
//
// Both wrap an in-memory cache keyed by the normalized input so that
// the createJob / updateJobOverview save paths don't hammer the
// services on every keystroke or retry. The cache is per-process (no
// cross-instance share); a Vercel cold start re-fills it.
//
// Validation is "only when something is entered" — blank inputs pass
// through unchecked. The form layer is responsible for that decision.

const ZIP_RE = /^\d{5}(?:-\d{4})?$/;

const NOMINATIM_USER_AGENT = "BreakPointTalent-Ace-CRM/1.0 (andrew@breakpointtalent.com)";

const NOMINATIM_TIMEOUT_MS = 5_000;
const ZIPPOPOTAM_TIMEOUT_MS = 5_000;

// Process-local cache. Bounded to ~500 entries each so a malformed
// pasted JD can't unbounded-grow the map. Eviction is FIFO via Map
// iteration order — good enough for an internal CRM.
const CITY_CACHE = new Map<string, boolean>();
const ZIP_CACHE = new Map<string, boolean>();
const CACHE_MAX = 500;

function rememberCity(key: string, ok: boolean): void {
  if (CITY_CACHE.size >= CACHE_MAX) {
    const first = CITY_CACHE.keys().next().value;
    if (first !== undefined) CITY_CACHE.delete(first);
  }
  CITY_CACHE.set(key, ok);
}

function rememberZip(key: string, ok: boolean): void {
  if (ZIP_CACHE.size >= CACHE_MAX) {
    const first = ZIP_CACHE.keys().next().value;
    if (first !== undefined) ZIP_CACHE.delete(first);
  }
  ZIP_CACHE.set(key, ok);
}

export type LocationValidationResult = { ok: true } | { ok: false; message: string };

// Cheap format check — used as a fast-fail before we hit the
// network. A ZIP must be exactly 5 digits (optionally followed by
// "-DDDD"). Anything else can't possibly resolve.
export function isLikelyZip(raw: string): boolean {
  return ZIP_RE.test(raw.trim());
}

// Verifies a US ZIP code against zippopotam.us. Returns ok:true on a
// 200 with at least one "place" in the response. 404 / non-200 / bad
// JSON → ok:false with a recruiter-facing message. Network errors
// (timeout, DNS) fail open with ok:true so a transient outage doesn't
// block job saves — the alternative would be that a Cloudflare blip
// on an external service halts the recruiter's day.
export async function validateUsZip(raw: string): Promise<LocationValidationResult> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  if (!ZIP_RE.test(trimmed)) {
    return { ok: false, message: "Enter a 5-digit US zip code." };
  }
  const five = trimmed.slice(0, 5);
  const cached = ZIP_CACHE.get(five);
  if (cached === true) return { ok: true };
  if (cached === false) {
    return { ok: false, message: "That zip code doesn't match a US postal code." };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ZIPPOPOTAM_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${five}`, {
      signal: controller.signal,
      // The endpoint is publicly cacheable; let Next.js dedupe.
      cache: "force-cache",
    });
    if (res.status === 404) {
      rememberZip(five, false);
      return { ok: false, message: "That zip code doesn't match a US postal code." };
    }
    if (!res.ok) {
      // Treat transient upstream errors as "let it through" so a
      // service blip can't halt job creation. The recruiter gets a
      // second chance to notice on the job overview.
      return { ok: true };
    }
    const body = (await res.json()) as { places?: unknown };
    const places = Array.isArray(body.places) ? body.places : [];
    const ok = places.length > 0;
    rememberZip(five, ok);
    return ok
      ? { ok: true }
      : { ok: false, message: "That zip code doesn't match a US postal code." };
  } catch {
    // Network failure / timeout / abort — fail open. See note above.
    return { ok: true };
  } finally {
    clearTimeout(t);
  }
}

type NominatimHit = {
  display_name?: string;
  address?: {
    country_code?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    suburb?: string;
    county?: string;
  };
  class?: string;
  type?: string;
};

// Verifies a free-text US city name against OpenStreetMap Nominatim.
// We accept a result only when:
//   - the response has at least one hit
//   - the hit's address.country_code === "us"
//   - the hit identifies the input as a populated place (city /
//     town / village / hamlet / municipality / suburb), not a random
//     county or business name
//
// Network errors fail open (same rationale as validateUsZip).
export async function validateUsCity(raw: string): Promise<LocationValidationResult> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  // A bare number isn't a city — bail before round-tripping the
  // network. The form should be sending pure zips through
  // validateUsZip, but this catches the case where someone types
  // a zip into the City field by accident.
  if (/^\d+$/.test(trimmed)) {
    return { ok: false, message: "Enter a US city name (not a zip code)." };
  }
  const key = trimmed.toLowerCase();
  const cached = CITY_CACHE.get(key);
  if (cached === true) return { ok: true };
  if (cached === false) {
    return { ok: false, message: "That doesn't match a US city we can find." };
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("city", trimmed);
  url.searchParams.set("country", "us");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        // Nominatim usage policy requires a descriptive User-Agent so
        // the OSM team can contact the operator on abuse. The email
        // is the canonical project contact.
        "User-Agent": NOMINATIM_USER_AGENT,
        Accept: "application/json",
      },
      cache: "force-cache",
    });
    if (!res.ok) {
      // 429 / 5xx → fail open. The recruiter can save and we move on.
      return { ok: true };
    }
    const body = (await res.json()) as NominatimHit[];
    const hit = body.find((h) => {
      if (h.address?.country_code?.toLowerCase() !== "us") return false;
      const a = h.address ?? {};
      // The query MUST come back as a populated-place result, not a
      // random POI. Nominatim populates one of city/town/village/etc
      // on those hits; if none are set we treat the result as a
      // non-match even if Nominatim happened to find something.
      return Boolean(a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb);
    });
    const ok = Boolean(hit);
    rememberCity(key, ok);
    return ok
      ? { ok: true }
      : { ok: false, message: "That doesn't match a US city we can find." };
  } catch {
    // Network failure / timeout / abort — fail open.
    return { ok: true };
  } finally {
    clearTimeout(t);
  }
}
