"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { updateAppPreferences } from "@/lib/preferences";

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
