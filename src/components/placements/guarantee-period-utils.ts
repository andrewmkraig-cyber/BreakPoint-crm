// Pure date-math helper for the placements + pipeline guarantee surfaces.
// Lives in its own module (not the "use client" table component) so the
// placements-tab Server Component can call it during render. Callers from
// client surfaces (pipeline-view) import from here too.
//
// Hands back null when the placement does not qualify (no start date, or
// end already passed). Surfaces call this with their own billing-status
// guard already applied.

// Industry-standard guarantee window for permanent placements. Used when
// the placement has no recruiter-entered guaranteePeriodDays and no custom
// guarantee end date — so every billed/paid hired placement with a start
// date gets a countdown automatically (Ace fix 2026-05-26). Custom values
// still win: a non-null guaranteePeriodDays or customGuaranteeDate
// overrides this default.
export const DEFAULT_GUARANTEE_PERIOD_DAYS = 90;

export function resolveGuaranteeEnd(args: {
  startDateIso: string | null;
  guaranteePeriodDays: number | null;
  customGuaranteeDateIso: string | null;
}): string | null {
  const { startDateIso, guaranteePeriodDays, customGuaranteeDateIso } = args;
  if (customGuaranteeDateIso) return customGuaranteeDateIso;
  if (!startDateIso) return null;
  // Fall back to the 90-day default when no recruiter-entered value is set.
  // A zero or negative value still resolves to null - that's the explicit
  // "no guarantee" signal (e.g. contract placements with no replacement
  // obligation). A positive number wins over the default.
  const effectiveDays =
    guaranteePeriodDays != null
      ? guaranteePeriodDays
      : DEFAULT_GUARANTEE_PERIOD_DAYS;
  if (effectiveDays <= 0) return null;
  const start = new Date(startDateIso);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + effectiveDays);
  return end.toISOString();
}
