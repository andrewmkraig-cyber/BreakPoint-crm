// Pure helpers + shared types for CandidateCompactOverview. Lives in
// its own non-client module so server components (page.tsx,
// local-profile.tsx) can call them at render time. Exporting these
// from the "use client" component file turned every named export into
// a client reference, which threw a 500 when page.tsx invoked
// toExpectedSalary during SSR.

export type CandidateCompactOverviewExpectedSalary = {
  number: number | null;
  currency: string | null;
};

// Coerce the loose JsonValue / RFCandidate.expected_salary blob shape
// into the structured value the inline editor needs. Single source of
// truth shared by both server callers and the client editor so the
// edit input always seeds with the same number the display rendered.
export function toExpectedSalary(
  raw: unknown,
): CandidateCompactOverviewExpectedSalary | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { number?: unknown; currency?: unknown };
  const num =
    typeof obj.number === "number" && Number.isFinite(obj.number)
      ? obj.number
      : typeof obj.number === "string" && obj.number.trim() !== ""
        ? Number(obj.number)
        : null;
  const currency =
    typeof obj.currency === "string" && obj.currency.trim() !== ""
      ? obj.currency.trim()
      : null;
  if (num == null && !currency) return null;
  return { number: num != null && Number.isFinite(num) ? num : null, currency };
}
