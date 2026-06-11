"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  updateAppPreferences,
  setNotifChannelForEmail,
  BULK_SPACING_MIN,
  BULK_SPACING_MAX,
  BULK_DAILY_CAP_MIN,
  BULK_DAILY_CAP_MAX,
} from "@/lib/preferences";

type Result = { ok: true } | { ok: false; error: string };

async function requireEmail(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  return s?.user?.email ?? null;
}

export async function setAutoSendCandidateConfirmation(enabled: boolean): Promise<Result> {
  if (!(await requireEmail())) return { ok: false, error: "Not signed in." };
  try {
    await updateAppPreferences({ autoSendCandidateConfirmation: enabled });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update preferences." };
  }
}

export async function setMyRecruiterPhone(phone: string): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  try {
    await updateAppPreferences({
      recruiterPhones: { [email]: phone.trim() },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save phone." };
  }
}

// Persist the OS/desktop push side of a notification channel switch.
// The in-app popup side is gated client-side via localStorage; the
// settings toggle writes both so one switch silences both surfaces.
export async function setMailNotificationsEnabled(enabled: boolean): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  try {
    await setNotifChannelForEmail(email, "mail", enabled);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save setting." };
  }
}

export async function setPhoneNotificationsEnabled(enabled: boolean): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  try {
    await setNotifChannelForEmail(email, "phone", enabled);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save setting." };
  }
}

// Bulk send spacing, in whole minutes between each candidate send. 0 =
// send as fast as the per-minute queue allows. Stored org-wide.
export async function setBulkSendSpacing(minutes: number): Promise<Result> {
  if (!(await requireEmail())) return { ok: false, error: "Not signed in." };
  if (!Number.isFinite(minutes) || minutes < BULK_SPACING_MIN || minutes > BULK_SPACING_MAX) {
    return { ok: false, error: `Spacing must be between ${BULK_SPACING_MIN} and ${BULK_SPACING_MAX} minutes.` };
  }
  try {
    await updateAppPreferences({ bulkSendSpacingMinutes: Math.round(minutes) });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save spacing." };
  }
}

// Max bulk candidate emails per Eastern calendar day. Overflow rolls to
// the next day at 8am ET.
export async function setBulkDailyCap(cap: number): Promise<Result> {
  if (!(await requireEmail())) return { ok: false, error: "Not signed in." };
  if (!Number.isFinite(cap) || cap < BULK_DAILY_CAP_MIN || cap > BULK_DAILY_CAP_MAX) {
    return { ok: false, error: `Daily cap must be between ${BULK_DAILY_CAP_MIN} and ${BULK_DAILY_CAP_MAX}.` };
  }
  try {
    await updateAppPreferences({ bulkDailyCap: Math.round(cap) });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save daily cap." };
  }
}

export async function setMyEmailSignature(signature: string): Promise<Result> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: "Not signed in." };
  try {
    await updateAppPreferences({
      emailSignatures: { [email]: signature },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save signature." };
  }
}
