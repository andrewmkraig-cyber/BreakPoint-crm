// Single source of truth for mapping a calendar source OR a team
// member to a normalized owner key. Both sides (event.ownerId and
// teamMember.id) must produce the same key for the toggle/filter to
// agree. The previous logic compared against per-user cuids; that
// failed for Austin because his synced calendar lives under a
// personal Google email — not his BreakPoint user.email — so the
// cuid-based match never hit and his Team toggle never filtered.
//
// Two recognized keys today: "ak" (Andrew) and "austin" (Austin).
// Any future member falls through to a slug of their email.

const KNOWN: Array<{ key: string; needles: string[] }> = [
  { key: "austin", needles: ["austin", "barnard"] },
  { key: "ak", needles: ["andrew", "kraig"] },
];

function matchKey(...sources: Array<string | null | undefined>): string | null {
  const hay = sources
    .filter((s): s is string => Boolean(s))
    .map((s) => s.toLowerCase())
    .join(" ");
  if (!hay) return null;
  for (const { key, needles } of KNOWN) {
    if (needles.some((n) => hay.includes(n))) return key;
  }
  return null;
}

function slugFrom(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

// Owner key for a synced calendar row. We look at calendarId +
// calendarName first (the most reliable Austin signal — his shared
// calendar surfaces with his name or personal email in one or both
// fields). If neither yields a match, the event came from a calendar
// the signed-in user owns directly — like their `primary` whose id is
// just the literal "primary" — so we fall back to the self user's
// own key.
export function ownerKeyForCalendar(
  source: { calendarId?: string | null; calendarName?: string | null },
  selfPerson: { name?: string | null; email?: string | null } | null,
): string {
  const fromCal = matchKey(source.calendarId, source.calendarName);
  if (fromCal) return fromCal;
  if (selfPerson) return ownerKeyForPerson(selfPerson);
  return "unknown";
}

// Owner key for a team member (org user row). Uses name + email so
// the team-toggle id matches whatever key the event side resolved to.
export function ownerKeyForPerson(person: {
  name?: string | null;
  email?: string | null;
}): string {
  const matched = matchKey(person.name, person.email);
  if (matched) return matched;
  if (person.email) return slugFrom(person.email);
  return "unknown";
}
