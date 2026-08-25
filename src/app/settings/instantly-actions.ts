"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { updateInstantlyPrefs, type InstantlyPrefs } from "@/lib/instantly/prefs";

type Result = { ok: true } | { ok: false; error: string };

async function requireEmail(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  return s?.user?.email ?? null;
}

// Instantly reply-notification settings. Same Result shape + revalidate
// pattern as preferences-actions.ts, so the Settings toggles behave
// identically to the notification ones.

export async function setInstantlyPref(
  patch: Partial<InstantlyPrefs>,
): Promise<Result> {
  if (!(await requireEmail())) return { ok: false, error: "Not signed in." };
  try {
    await updateInstantlyPrefs(patch);
    revalidatePath("/settings/connectors");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save setting.",
    };
  }
}
