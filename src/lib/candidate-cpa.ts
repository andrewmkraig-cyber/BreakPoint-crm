// CPA credential vocabulary, shared by the candidate profile control,
// the Candidate Search rail, and the search API.
//
// This module is deliberately prisma-free (Ace 99.0 rule): the profile
// control and the search rail are both "use client", so anything they
// import must never drag @/lib/prisma into the browser bundle. The
// values here mirror the CpaStatus enum in prisma/schema.prisma.
//
// Three real states, no null. UNKNOWN is the column default and means
// "nobody has recorded this yet" - it is NOT a synonym for NO, and the
// search filter deliberately excludes it from BOTH the Yes and the No
// result sets. CPA is only ever set by a human on the profile; it is
// never inferred from notes, tags, skills, or resume text.

export const CPA_VALUES = ["UNKNOWN", "YES", "NO"] as const;

export type CpaValue = (typeof CPA_VALUES)[number];

export const CPA_LABELS: Record<CpaValue, string> = {
  UNKNOWN: "Unknown",
  YES: "Yes",
  NO: "No",
};

// Profile control options, in the order they render in the dropdown.
export const CPA_OPTIONS: Array<{ value: CpaValue; label: string }> = [
  { value: "UNKNOWN", label: CPA_LABELS.UNKNOWN },
  { value: "YES", label: CPA_LABELS.YES },
  { value: "NO", label: CPA_LABELS.NO },
];

// Search-rail filter values. "any" is the default and applies no
// clause at all; "yes" / "no" match the stored value exactly, so an
// UNKNOWN candidate falls out of both.
export const CPA_FILTER_VALUES = ["any", "yes", "no"] as const;

export type CpaFilterValue = (typeof CPA_FILTER_VALUES)[number];

export const CPA_FILTER_OPTIONS: Array<{
  value: CpaFilterValue;
  label: string;
}> = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

// Coerce an untrusted value (localStorage saved search, query string)
// into a valid profile value. Anything unrecognized falls back to the
// column default so a malformed input can never write a bad state.
export function coerceCpaValue(raw: unknown): CpaValue {
  return CPA_VALUES.includes(raw as CpaValue) ? (raw as CpaValue) : "UNKNOWN";
}

// Coerce an untrusted value into a valid filter value. Anything
// unrecognized falls back to "any" so a malformed query string widens
// to the safe default rather than silently narrowing results - same
// posture as the employerScope param in the search route.
export function coerceCpaFilter(raw: unknown): CpaFilterValue {
  return CPA_FILTER_VALUES.includes(raw as CpaFilterValue)
    ? (raw as CpaFilterValue)
    : "any";
}

// Filter value -> the stored value it must equal, or null when the
// filter applies no clause. Single definition so the rail and the API
// can never disagree about what "No" means.
export function cpaFilterToStoredValue(
  filter: CpaFilterValue,
): CpaValue | null {
  if (filter === "yes") return "YES";
  if (filter === "no") return "NO";
  return null;
}
