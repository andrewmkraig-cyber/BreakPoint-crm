import { prisma } from "@/lib/prisma";

// App preferences are stored as a single JSON blob under Setting.key =
// "app.preferences" so we don't need a dedicated table. Per-user fields
// (recruiter phone) live under a `recruiterPhones` map keyed by email —
// small team, lazy UX, good enough.

const PREFS_KEY = "app.preferences";

// Per-user notification channel switches. `true` = that channel's
// notifications (OS/desktop push AND in-app popups) fire for the user;
// `false` = silenced. Missing entry defaults to enabled, so existing
// users keep the always-on push behavior until they explicitly turn a
// channel off in Settings. "phone" covers both texts and calls.
export type NotifChannelPrefs = { mail: boolean; phone: boolean };

export type AppPreferences = {
  autoSendCandidateConfirmation: boolean;
  recruiterPhones: Record<string, string>;
  emailSignatures: Record<string, string>;
  notifPrefs: Record<string, NotifChannelPrefs>;
  // Bulk email pacing. spacing = minutes between each candidate send in a
  // throttled bulk batch (0 = send as fast as the per-minute sender
  // allows). dailyCap = max bulk candidate emails per Eastern calendar
  // day; anything over the cap rolls to the next day at 8am ET. Both are
  // org-wide (single-tenant internal app). Consumed by the bulk send queue
  // (src/lib/bulk-send-queue.ts).
  bulkSendSpacingMinutes: number;
  bulkDailyCap: number;
};

export const BULK_SPACING_MIN = 0;
export const BULK_SPACING_MAX = 120;
export const BULK_DAILY_CAP_MIN = 1;
export const BULK_DAILY_CAP_MAX = 5000;

const DEFAULT_SIGNATURE =
  "Andrew Kraig\n" +
  "Managing Partner & Founder\n" +
  "BreakPoint Talent\n" +
  "andrew@breakpointtalent.com\n" +
  "216-488-5565";

const DEFAULT_PREFS: AppPreferences = {
  autoSendCandidateConfirmation: true,
  recruiterPhones: {
    "andrew@breakpointtalent.com": "216-488-5565",
  },
  emailSignatures: {
    "andrew@breakpointtalent.com": DEFAULT_SIGNATURE,
  },
  notifPrefs: {},
  bulkSendSpacingMinutes: 2,
  bulkDailyCap: 50,
};

// Coerce a stored number into the allowed range, falling back to the
// default on any non-finite / out-of-range value. Bulk pacing inputs
// come from a user-facing settings field, so we never trust them raw.
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalize(raw: unknown): AppPreferences {
  const obj = (raw as Partial<AppPreferences> | null | undefined) ?? {};
  return {
    autoSendCandidateConfirmation: typeof obj.autoSendCandidateConfirmation === "boolean"
      ? obj.autoSendCandidateConfirmation
      : DEFAULT_PREFS.autoSendCandidateConfirmation,
    recruiterPhones: isStringMap(obj.recruiterPhones)
      ? { ...DEFAULT_PREFS.recruiterPhones, ...obj.recruiterPhones }
      : DEFAULT_PREFS.recruiterPhones,
    emailSignatures: isStringMap(obj.emailSignatures)
      ? { ...DEFAULT_PREFS.emailSignatures, ...obj.emailSignatures }
      : DEFAULT_PREFS.emailSignatures,
    notifPrefs: normalizeNotifPrefs(obj.notifPrefs),
    bulkSendSpacingMinutes: clampInt(
      obj.bulkSendSpacingMinutes,
      BULK_SPACING_MIN,
      BULK_SPACING_MAX,
      DEFAULT_PREFS.bulkSendSpacingMinutes,
    ),
    bulkDailyCap: clampInt(
      obj.bulkDailyCap,
      BULK_DAILY_CAP_MIN,
      BULK_DAILY_CAP_MAX,
      DEFAULT_PREFS.bulkDailyCap,
    ),
  };
}

function isStringMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === "string");
}

// Coerce a stored notifPrefs blob into a clean { email -> {mail,phone} }
// map. Any missing / non-boolean channel defaults to true (enabled) so a
// partially-written entry never silences a channel by accident.
function normalizeNotifPrefs(v: unknown): Record<string, NotifChannelPrefs> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, NotifChannelPrefs> = {};
  for (const [email, val] of Object.entries(v as Record<string, unknown>)) {
    const o = (val ?? {}) as Partial<NotifChannelPrefs>;
    out[email] = {
      mail: typeof o.mail === "boolean" ? o.mail : true,
      phone: typeof o.phone === "boolean" ? o.phone : true,
    };
  }
  return out;
}

export async function getAppPreferences(): Promise<AppPreferences> {
  const row = await prisma.setting.findUnique({ where: { key: PREFS_KEY } });
  return normalize(row?.value);
}

// Bulk pacing settings, resolved + clamped. The bulk send queue reads
// this to space each candidate send and to enforce the per-ET-day cap.
export async function getBulkSendSettings(): Promise<{
  spacingMinutes: number;
  dailyCap: number;
}> {
  const prefs = await getAppPreferences();
  return {
    spacingMinutes: prefs.bulkSendSpacingMinutes,
    dailyCap: prefs.bulkDailyCap,
  };
}

export async function updateAppPreferences(patch: Partial<AppPreferences>): Promise<AppPreferences> {
  const current = await getAppPreferences();
  const next: AppPreferences = {
    autoSendCandidateConfirmation:
      typeof patch.autoSendCandidateConfirmation === "boolean"
        ? patch.autoSendCandidateConfirmation
        : current.autoSendCandidateConfirmation,
    recruiterPhones: {
      ...current.recruiterPhones,
      ...(patch.recruiterPhones ?? {}),
    },
    emailSignatures: {
      ...current.emailSignatures,
      ...(patch.emailSignatures ?? {}),
    },
    // Per-email deep merge: a patch that sets one user's {mail} must not
    // wipe their {phone} (or another user's entry entirely).
    notifPrefs: mergeNotifPrefs(current.notifPrefs, patch.notifPrefs),
    bulkSendSpacingMinutes:
      patch.bulkSendSpacingMinutes != null
        ? clampInt(patch.bulkSendSpacingMinutes, BULK_SPACING_MIN, BULK_SPACING_MAX, current.bulkSendSpacingMinutes)
        : current.bulkSendSpacingMinutes,
    bulkDailyCap:
      patch.bulkDailyCap != null
        ? clampInt(patch.bulkDailyCap, BULK_DAILY_CAP_MIN, BULK_DAILY_CAP_MAX, current.bulkDailyCap)
        : current.bulkDailyCap,
  };
  await prisma.setting.upsert({
    where: { key: PREFS_KEY },
    create: { key: PREFS_KEY, value: next },
    update: { value: next },
  });
  return next;
}

const LEGACY_DEFAULT_SIGNATURE =
  "Andrew Kraig\n" +
  "Managing Partner & Founder\n" +
  "andrew@breakpointtalent.com\n" +
  "216-488-5565\n" +
  "www.breakpointtalent.com";

export async function ensureDefaultPreferences(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: PREFS_KEY } });
  if (!row) {
    await prisma.setting.create({ data: { key: PREFS_KEY, value: DEFAULT_PREFS } });
    return;
  }
  // One-shot migration: replace the old seeded Andrew signature with the
  // current default. Only triggers if the stored value matches the legacy
  // default exactly — user edits are left untouched.
  const stored = normalize(row.value);
  const andrewSig = stored.emailSignatures["andrew@breakpointtalent.com"];
  if (andrewSig === LEGACY_DEFAULT_SIGNATURE) {
    await prisma.setting.update({
      where: { key: PREFS_KEY },
      data: {
        value: {
          ...stored,
          emailSignatures: {
            ...stored.emailSignatures,
            "andrew@breakpointtalent.com": DEFAULT_SIGNATURE,
          },
        },
      },
    });
  }
}

function mergeNotifPrefs(
  current: Record<string, NotifChannelPrefs>,
  patch: Record<string, NotifChannelPrefs> | undefined,
): Record<string, NotifChannelPrefs> {
  if (!patch) return current;
  const next = { ...current };
  for (const [email, channels] of Object.entries(patch)) {
    const existing = next[email] ?? { mail: true, phone: true };
    next[email] = {
      mail: typeof channels.mail === "boolean" ? channels.mail : existing.mail,
      phone: typeof channels.phone === "boolean" ? channels.phone : existing.phone,
    };
  }
  return next;
}

// Resolve a user's notification switches by email. Missing entry => both
// channels enabled (the default-on contract).
export async function getNotifPrefsForEmail(
  email: string | null | undefined,
): Promise<NotifChannelPrefs> {
  if (!email) return { mail: true, phone: true };
  const prefs = await getAppPreferences();
  return (
    prefs.notifPrefs[email.toLowerCase()] ??
    prefs.notifPrefs[email] ?? { mail: true, phone: true }
  );
}

// Server-side push gate used by the Quo + Gmail webhooks. Resolves the
// target user's email from their id, then checks the channel switch.
// Defaults to enabled on any miss so a lookup hiccup never silently
// drops a notification.
export async function isChannelPushEnabledForUserId(
  userId: string,
  channel: keyof NotifChannelPrefs,
): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) return true;
    const prefs = await getNotifPrefsForEmail(user.email);
    return prefs[channel];
  } catch {
    return true;
  }
}

// Write a single channel switch for a user, preserving the other channel.
export async function setNotifChannelForEmail(
  email: string,
  channel: keyof NotifChannelPrefs,
  enabled: boolean,
): Promise<NotifChannelPrefs> {
  const next = await updateAppPreferences({
    notifPrefs: { [email.toLowerCase()]: { [channel]: enabled } as NotifChannelPrefs },
  });
  return next.notifPrefs[email.toLowerCase()] ?? { mail: true, phone: true };
}

export async function getRecruiterPhone(email: string | null | undefined): Promise<string> {
  if (!email) return "";
  const prefs = await getAppPreferences();
  return prefs.recruiterPhones[email.toLowerCase()] ?? prefs.recruiterPhones[email] ?? "";
}

// Returns the user's saved email signature. Falls back to the Andrew default
// so every outbound email has a sane sign-off even before a user has set
// theirs.
export async function getEmailSignature(email: string | null | undefined): Promise<string> {
  const prefs = await getAppPreferences();
  if (email) {
    const hit = prefs.emailSignatures[email.toLowerCase()] ?? prefs.emailSignatures[email];
    if (hit != null) return hit;
  }
  return prefs.emailSignatures["andrew@breakpointtalent.com"] ?? DEFAULT_SIGNATURE;
}
