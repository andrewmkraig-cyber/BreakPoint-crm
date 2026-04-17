import { prisma } from "@/lib/prisma";

// App preferences are stored as a single JSON blob under Setting.key =
// "app.preferences" so we don't need a dedicated table. Per-user fields
// (recruiter phone) live under a `recruiterPhones` map keyed by email —
// small team, lazy UX, good enough.

const PREFS_KEY = "app.preferences";

export type AppPreferences = {
  autoSendCandidateConfirmation: boolean;
  recruiterPhones: Record<string, string>;
};

const DEFAULT_PREFS: AppPreferences = {
  autoSendCandidateConfirmation: true,
  recruiterPhones: {
    "andrew@breakpointtalent.com": "216-488-5565",
  },
};

function normalize(raw: unknown): AppPreferences {
  const obj = (raw as Partial<AppPreferences> | null | undefined) ?? {};
  return {
    autoSendCandidateConfirmation: typeof obj.autoSendCandidateConfirmation === "boolean"
      ? obj.autoSendCandidateConfirmation
      : DEFAULT_PREFS.autoSendCandidateConfirmation,
    recruiterPhones: isPhoneMap(obj.recruiterPhones)
      ? { ...DEFAULT_PREFS.recruiterPhones, ...obj.recruiterPhones }
      : DEFAULT_PREFS.recruiterPhones,
  };
}

function isPhoneMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object") return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === "string");
}

export async function getAppPreferences(): Promise<AppPreferences> {
  const row = await prisma.setting.findUnique({ where: { key: PREFS_KEY } });
  return normalize(row?.value);
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
  };
  await prisma.setting.upsert({
    where: { key: PREFS_KEY },
    create: { key: PREFS_KEY, value: next },
    update: { value: next },
  });
  return next;
}

export async function ensureDefaultPreferences(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: PREFS_KEY } });
  if (row) return;
  await prisma.setting.create({ data: { key: PREFS_KEY, value: DEFAULT_PREFS } });
}

export async function getRecruiterPhone(email: string | null | undefined): Promise<string> {
  if (!email) return "";
  const prefs = await getAppPreferences();
  return prefs.recruiterPhones[email.toLowerCase()] ?? prefs.recruiterPhones[email] ?? "";
}
