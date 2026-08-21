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

const MS_PER_DAY = 86_400_000;

// Days left on a guarantee, or null once it has run out (or the end date
// is unparseable). Math.ceil so an end date later today still reads "1
// day"; only a genuinely elapsed guarantee returns null.
//
// Extracted from GuaranteePeriodTable so the retained-searches card counts
// down off the exact same math instead of forking it. The table still owns
// the ticking `now` that drives a live recount; this is the pure part.
export function guaranteeDaysRemaining(
  guaranteeEndIso: string,
  nowMs: number,
): number | null {
  const endMs = new Date(guaranteeEndIso).getTime();
  if (!Number.isFinite(endMs)) return null;
  const daysRemaining = Math.ceil((endMs - nowMs) / MS_PER_DAY);
  return daysRemaining > 0 ? daysRemaining : null;
}

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
  // UTC day math, not local. startDateIso is a date-only value stored at
  // midnight UTC, so getDate()/setDate() in a behind-UTC zone (ET) read the
  // PREVIOUS day and pushed the resolved end a day early — an 8/31 start
  // resolved to 11/28 instead of 11/29. getUTCDate()/setUTCDate() keeps the
  // result on the same midnight-UTC grid the renderer formats in.
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + effectiveDays);
  return end.toISOString();
}
