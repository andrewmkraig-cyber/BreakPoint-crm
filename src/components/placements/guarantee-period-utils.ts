// Pure date-math helper for the placements + pipeline guarantee surfaces.
// Lives in its own module (not the "use client" table component) so the
// placements-tab Server Component can call it during render. Callers from
// client surfaces (pipeline-view) import from here too.
//
// Hands back null when the placement does not qualify (no start date, no
// guarantee terms, or end already passed). Surfaces call this with their
// own billing-status guard already applied.
export function resolveGuaranteeEnd(args: {
  startDateIso: string | null;
  guaranteePeriodDays: number | null;
  customGuaranteeDateIso: string | null;
}): string | null {
  const { startDateIso, guaranteePeriodDays, customGuaranteeDateIso } = args;
  if (customGuaranteeDateIso) return customGuaranteeDateIso;
  if (!startDateIso) return null;
  if (guaranteePeriodDays == null || guaranteePeriodDays <= 0) return null;
  const start = new Date(startDateIso);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + guaranteePeriodDays);
  return end.toISOString();
}
