export type CandidateLocationParts = {
  city: string;
  state: string;
  zip: string;
};

const EMPTY_LOCATION_PARTS: CandidateLocationParts = {
  city: "",
  state: "",
  zip: "",
};

const COUNTRY_SUFFIXES = new Set([
  "united states",
  "united states of america",
  "usa",
  "us",
  "u.s.",
  "u.s.a.",
  "america",
]);

export function splitCandidateLocation(raw: string | null | undefined): CandidateLocationParts {
  const normalized = (raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ");
  if (!normalized) return { ...EMPTY_LOCATION_PARTS };

  const parts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  while (parts.length > 0 && COUNTRY_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }

  if (parts.length === 0) return { ...EMPTY_LOCATION_PARTS };

  let zip = "";
  const lastIndex = parts.length - 1;
  const lastPart = parts[lastIndex];
  const zipMatch = lastPart.match(/\b\d{5}(?:-\d{4})?\b$/);
  if (zipMatch) {
    zip = zipMatch[0];
    const withoutZip = lastPart.slice(0, zipMatch.index).replace(/[,\s]+$/g, "").trim();
    if (withoutZip) {
      parts[lastIndex] = withoutZip;
    } else {
      parts.pop();
    }
  }

  if (parts.length === 0) {
    return { city: "", state: "", zip };
  }

  if (parts.length === 1) {
    const onlyPart = parts[0];
    if (/^[A-Za-z]{2}$/.test(onlyPart) && zip) {
      return { city: "", state: onlyPart.toUpperCase(), zip };
    }
    return { city: onlyPart, state: "", zip };
  }

  const state = parts.pop() ?? "";
  return {
    city: parts.join(", "),
    state,
    zip,
  };
}

export function composeCandidateLocation(parts: CandidateLocationParts): string {
  const city = parts.city.trim();
  const stateRaw = parts.state.trim();
  const state = /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : stateRaw;
  const zip = parts.zip.trim();

  if (city && state && zip) return `${city}, ${state} ${zip}`;
  if (city && state) return `${city}, ${state}`;
  if (city && zip) return `${city} ${zip}`;
  if (state && zip) return `${state} ${zip}`;
  return city || state || zip;
}
