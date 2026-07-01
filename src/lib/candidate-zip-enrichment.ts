import {
  composeCandidateLocation,
  splitCandidateLocation,
} from "@/lib/candidate-location-parts";
import { lookupUsZipForCityState } from "@/lib/location-validation";
import { abbreviateState } from "@/lib/utils";

type CandidateWithLocation = {
  location: string | null;
  zip: string | null;
};

type ZipLookup = (city: string, state: string) => Promise<string | null>;

function normalizeZip(raw: string | null | undefined): string {
  return raw?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? "";
}

export async function enrichCandidateZipFromCity<T extends CandidateWithLocation>(
  candidate: T,
  lookup: ZipLookup = lookupUsZipForCityState,
): Promise<T> {
  const parsedLocation = splitCandidateLocation(candidate.location);
  const existingZip = normalizeZip(candidate.zip) || normalizeZip(parsedLocation.zip);
  if (existingZip) {
    return {
      ...candidate,
      zip: existingZip,
      location: composeCandidateLocation({
        city: parsedLocation.city,
        state: parsedLocation.state ? abbreviateState(parsedLocation.state) : parsedLocation.state,
        zip: existingZip,
      }) || candidate.location,
    };
  }

  if (!parsedLocation.city || !parsedLocation.state) return candidate;

  const state = abbreviateState(parsedLocation.state);
  const zip = await lookup(parsedLocation.city, state);
  if (!zip) return candidate;

  return {
    ...candidate,
    zip,
    location: composeCandidateLocation({
      city: parsedLocation.city,
      state,
      zip,
    }),
  };
}

