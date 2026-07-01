import { geocodePill, type GeoHit } from "./geocode";

type LookupCandidateLocation = (location: string) => Promise<GeoHit | null>;

export type CandidateCoordinatePatch = {
  lat?: number | null;
  lng?: number | null;
};

function hasCoordinates(lat: number | null | undefined, lng: number | null | undefined) {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
}

export async function coordinatePatchForCandidateLocationUpdate({
  nextLocation,
  previousLocation,
  previousLat,
  previousLng,
  lookup = geocodePill,
}: {
  nextLocation: string | null | undefined;
  previousLocation?: string | null;
  previousLat?: number | null;
  previousLng?: number | null;
  lookup?: LookupCandidateLocation;
}): Promise<CandidateCoordinatePatch> {
  const next = nextLocation?.trim() ?? "";
  const previous = previousLocation?.trim() ?? "";

  if (!next) return { lat: null, lng: null };
  if (next === previous && hasCoordinates(previousLat, previousLng)) return {};

  const hit = await lookup(next);
  if (!hit) return { lat: null, lng: null };
  return { lat: hit.lat, lng: hit.lng };
}
