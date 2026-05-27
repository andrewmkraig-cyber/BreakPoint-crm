// Calendar-event dedupe helpers. CalendarEvent rows can come back from
// the Google sync more than once for what is logically the same invite:
//
//   1. The SAME googleEventId appears on multiple calendars when an
//      event is shared (Andrew's primary + Austin's primary). The
//      /calendar page already merges these by googleEventId so the
//      grid renders one block with both owner keys.
//
//   2. DIFFERENT googleEventIds can describe the same invite because
//      Google mints a separate event row per attendee calendar. The
//      stable cross-calendar identifier is iCalUID — which we don't
//      mirror yet (TODO: add CalendarEvent.iCalUID + populate in
//      google-sync, then prefer it here). Until then we fall back to
//      a composite key of title|start|end|meetLink so two rows that
//      describe the obviously-same meeting collapse to one.
//
// The fallback is intentionally conservative: title differences,
// reschedules to a new time, and Meet-link changes all defeat it, so
// the worst case is failing to dedupe (still preferable to wrongly
// merging two genuinely distinct events).

type RowLike = {
  id: string;
  googleEventId?: string | null;
  title: string;
  startTime: Date;
  endTime: Date;
  meetLink?: string | null;
};

function fallbackKey(r: RowLike): string {
  const title = r.title.trim().toLowerCase();
  const start = r.startTime.getTime();
  const end = r.endTime.getTime();
  const meet = (r.meetLink ?? "").trim().toLowerCase();
  return `${title}|${start}|${end}|${meet}`;
}

// Returns the input rows with same-invite duplicates collapsed. Order
// is preserved — the first occurrence wins, so callers should sort
// before calling if a particular row (e.g. the self-owned copy) should
// be canonical.
export function dedupeCalendarRows<T extends RowLike>(rows: T[]): T[] {
  const seenEventId = new Set<string>();
  const seenFallback = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const eid = r.googleEventId ?? "";
    if (eid && seenEventId.has(eid)) continue;
    const fk = fallbackKey(r);
    if (seenFallback.has(fk)) continue;
    if (eid) seenEventId.add(eid);
    seenFallback.add(fk);
    out.push(r);
  }
  return out;
}
