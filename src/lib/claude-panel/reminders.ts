// Shared validation for the Ace Assistant `create_reminder` tool. Lives
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

  let notifyLeadsMin: number[] | undefined;
  if (Array.isArray(input.notifyLeadsMin)) {
    const cleaned = input.notifyLeadsMin.filter(
      (n): n is number => typeof n === "number" && ALLOWED_LEADS.has(n),
    );
    notifyLeadsMin = cleaned.length > 0 ? cleaned : undefined;
  }

  return { ok: true, title, reminderAtIso: iso, notifyLeadsMin };
}
