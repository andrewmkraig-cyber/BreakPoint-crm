// Shared validation for the Wilson `create_reminder` tool. Lives
// in lib so BOTH callers enforce the SAME rules:
//  - the chat route (src/app/api/claude-panel/chat/route.ts) on the
//    direct, batched, under-the-cap execution path, and
//  - the action route (src/app/api/claude-panel/action/route.ts) on the
//    over-the-cap single-Confirm fallback path.
//
// Timezone is the #1 risk. The assistant runs SERVER-SIDE, and the
// Vercel Node runtime parses a NAIVE datetime string (one with no
// offset) as UTC, which skews an Eastern-Time reminder by 4-5 hours.
// So we REJECT any reminderAtIso that lacks an explicit offset
// designator rather than guess a zone. The tool description instructs
// the model to emit the Eastern offset (-04:00 EDT / -05:00 EST); this
// validator's job is only to guarantee SOME explicit offset is present,
// which is the exact defense against the naive-string skew. A correctly
// offset-qualified instant (whether `Z` or `±HH:MM`) parses to the same
// absolute moment regardless of where the server runs.

// Notification leads createReminder accepts. Mirrored here so a bad
// lead is dropped before it ever reaches the server action (which
// re-sanitizes anyway).
const ALLOWED_LEADS = new Set([0, 15, 30, 60, 120, 1440]);

// Requires a time component (`T` or space + HH:MM) AND a trailing
// offset (`Z` or `±HH:MM`, colon optional). Date-only strings and naive
// datetimes both fail — a reminder needs a concrete instant, not a bare
// day.
const ISO_WITH_OFFSET = /[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

// Pull the leading wall-clock components (date + time) off an ISO string,
// ignoring whatever offset was appended. Used by the Eastern re-anchor.
const WALLCLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

// The correct Eastern UTC offset for a given calendar date, DST-aware via
// Intl. Probed at 12:00 UTC so we sit far from either DST edge and the
// offset is unambiguous for the whole local day.
function easternOffsetForDate(year: number, month: number, day: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const raw =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
    })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  return raw.replace(/^GMT/, "").trim() || "-05:00";
}

// Force an offset-qualified ISO onto the correct Eastern wall-clock offset
// for its OWN date. Every Ace reminder is Eastern (the reminder surfaces
// hard-code ET; per-user tz is a future multi-user item), so re-stamping
// the same wall-clock digits with the DST-correct ET offset makes a WRONG
// offset impossible to silently skew: a correct -04:00 / -05:00 emission
// is a no-op, while a stray `Z` or a non-ET offset (the 2-hour / 4-5 hour
// skew class) is corrected back to the recruiter's intended Eastern time.
// Naive strings never reach here — they're rejected first by ISO_WITH_OFFSET.
export function reanchorToEastern(iso: string): string {
  const m = iso.match(WALLCLOCK);
  if (!m) return iso;
  const [, y, mo, d, h, mi, s] = m;
  const offset = easternOffsetForDate(Number(y), Number(mo), Number(d));
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}${offset}`;
}

export type ParsedReminder =
  | { ok: true; title: string; reminderAtIso: string; notifyLeadsMin: number[] | undefined }
  | { ok: false; title: string; reason: string };

// Validate + normalize one create_reminder tool input. Never throws —
// returns a discriminated result so the caller can accumulate per-item
// failures into the batch receipt instead of blowing up the turn.
export function parseReminderToolInput(raw: unknown): ParsedReminder {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const iso = typeof input.reminderAtIso === "string" ? input.reminderAtIso.trim() : "";

  if (!title) {
    return { ok: false, title: title || "(untitled)", reason: "missing title" };
  }
  if (!iso) {
    return { ok: false, title, reason: "missing time" };
  }
  if (!ISO_WITH_OFFSET.test(iso)) {
    return { ok: false, title, reason: "missing timezone offset" };
  }
  if (Number.isNaN(new Date(iso).getTime())) {
    return { ok: false, title, reason: "invalid date" };
  }

  // Defense-in-depth: re-anchor the wall-clock onto the DST-correct
  // Eastern offset so a wrong / `Z` offset can never skew silently.
  const anchored = reanchorToEastern(iso);
  return { ok: true, title, reminderAtIso: anchored, notifyLeadsMin: sanitizeNotifyLeads(input) };
}

// Phantom-claim detector. The model sometimes TYPES a success sentence
// ("Added 1 reminder", "Reminder set", "I've scheduled that reminder")
// WITHOUT actually calling create_reminder, so nothing saves but the
// recruiter sees what looks like a confirmation. The chat route runs this
// against the assistant's final text: if it asserts a reminder was saved
// AND no create_reminder tool actually executed that turn, the route
// suppresses the false success with an honest "not saved" receipt instead.
// Bidirectional (verb-before-noun AND noun-before-verb) and negation-aware
// so an honest failure admission ("I didn't save that reminder") is NOT
// flagged as a fake success.
export function claimsReminderSaved(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!/\breminders?\b/.test(t)) return false;
  const affirmative =
    /\b(added|created|saved|scheduled|set)\b[^.!?\n]{0,40}\breminders?\b/.test(t) ||
    /\breminders?\b[^.!?\n]{0,25}\b(set|added|created|saved|scheduled)\b/.test(t);
  if (!affirmative) return false;
  // Suppress when the sentence is a negation / failure admission (so the
  // honest "nothing was saved, please retry" line never self-triggers) OR
  // an offer / question ("would you like me to set a reminder?") rather than
  // a claim that one was already saved.
  const suppressed =
    /(n't|\bnot\b|\bnever\b|\bunable\b|\bfail(ed|s)?\b|\bcould\s+not\b|\bdid\s+not\b|\bcan\s+not\b|\bcannot\b|\bno reminder\b|\bnothing\b|\bwasn|\bisn|\baren|\bweren|\bwon't\b|\bunsaved\b|\bwould you like\b|\bdo you want\b|\bshould i\b|\bshall i\b|\bwant me to\b|\blike me to\b)/.test(t);
  return !suppressed;
}

// Keep only allowed leads; undefined when none survive so the server
// action falls back to its standard single 15-minute lead.
function sanitizeNotifyLeads(input: Record<string, unknown>): number[] | undefined {
  if (!Array.isArray(input.notifyLeadsMin)) return undefined;
  const cleaned = input.notifyLeadsMin.filter(
    (n): n is number => typeof n === "number" && ALLOWED_LEADS.has(n),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}
