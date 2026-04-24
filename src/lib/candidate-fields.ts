import type { RFCandidate } from "@/lib/rf-payload-shapes";

// Shared candidate-name extraction. Uses `||` (not `??`) for every step so
// empty strings from RF fall through to the next fallback. This was the root
// cause of merge-field tokens rendering blank ("Hi ,") — RF sometimes returns
// first_name: "" with the full name only in the `name` field.
export type ExtractedName = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
};

function firstEmail(raw: RFCandidate["email"]): string {
  if (Array.isArray(raw)) return (raw[0] ?? "").trim();
  return (raw ?? "").trim();
}

export function extractCandidateFields(c: RFCandidate): ExtractedName {
  const trimmedFirst = (c.first_name ?? "").trim();
  const trimmedLast = (c.last_name ?? "").trim();
  const combined = (c.name ?? "").trim();

  const parts = combined ? combined.split(/\s+/) : [];
  const fallbackFirst = parts[0] ?? "";
  const fallbackLast = parts.slice(1).join(" ");

  const firstName = trimmedFirst || fallbackFirst || "";
  const lastName = trimmedLast || fallbackLast || "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || combined || "";

  return {
    firstName,
    lastName,
    fullName,
    email: firstEmail(c.email),
  };
}
