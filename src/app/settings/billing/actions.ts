"use server";

import { revalidatePath } from "next/cache";

import {
  updateBillingSettings,
  type BillingSettings,
} from "@/lib/billing-settings";

export async function saveBillingSettingsAction(
  patch: Partial<BillingSettings>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateBillingSettings(patch);
    revalidatePath("/settings/billing");
    revalidatePath("/invoices");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save" };
  }
}
