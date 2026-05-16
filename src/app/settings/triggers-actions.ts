"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { TRIGGER_OPTIONS } from "@/app/settings/template-constants";

export type TriggerRuleRow = {
  triggerKey: string;
  label: string;
  description: string;
  enabled: boolean;
  sendAsDraft: boolean;
  templateId: string | null;
  templateName: string | null;
  // True when these values come from a real TriggerRule row; false when
  // they're synthesized defaults because no row exists yet.
  hasRule: boolean;
};

export type TemplateOption = {
  id: string;
  name: string;
};

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

async function requireSession(): Promise<true | { ok: false; error: string }> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return { ok: false, error: "Not signed in." };
  return true;
}

// Source of truth for the Triggers settings page. Joins every key in
// TRIGGER_OPTIONS (excluding the "Manual only" placeholder) with the
// per-org TriggerRule row when one exists. Synthesized rows surface as
// hasRule=false so the UI can render defaults without ambiguity.
export async function getTriggerRules(): Promise<TriggerRuleRow[]> {
  const auth = await requireSession();
  if (auth !== true) return [];

  const { id: organizationId } = await getCurrentOrg();

  const triggers = TRIGGER_OPTIONS.filter((o) => o.value !== "");
  const keys = triggers.map((t) => t.value);

  const rules = await prisma.triggerRule.findMany({
    where: { organizationId, triggerKey: { in: keys } },
    include: { template: { select: { id: true, name: true } } },
  });
  const byKey = new Map(rules.map((r) => [r.triggerKey, r]));

  return triggers.map((t) => {
    const rule = byKey.get(t.value);
    return {
      triggerKey: t.value,
      label: t.label,
      description: t.description,
      enabled: rule?.enabled ?? true,
      sendAsDraft: rule?.sendAsDraft ?? false,
      templateId: rule?.templateId ?? null,
      templateName: rule?.template?.name ?? null,
      hasRule: !!rule,
    };
  });
}

export async function upsertTriggerRule(input: {
  triggerKey: string;
  enabled?: boolean;
  sendAsDraft?: boolean;
  // null clears the override and reverts to the default trigger→template
  // lookup; undefined leaves the existing value alone.
  templateId?: string | null;
}): Promise<ActionResult> {
  const auth = await requireSession();
  if (auth !== true) return auth;

  const validKeys = new Set(
    TRIGGER_OPTIONS.filter((o) => o.value !== "").map((o) => o.value),
  );
  if (!validKeys.has(input.triggerKey)) {
    return { ok: false, error: "Unknown trigger key." };
  }

  try {
    const { id: organizationId } = await getCurrentOrg();

    const updateData: {
      enabled?: boolean;
      sendAsDraft?: boolean;
      templateId?: string | null;
    } = {};
    if (input.enabled !== undefined) updateData.enabled = input.enabled;
    if (input.sendAsDraft !== undefined) updateData.sendAsDraft = input.sendAsDraft;
    if (input.templateId !== undefined) updateData.templateId = input.templateId;

    await prisma.triggerRule.upsert({
      where: {
        organizationId_triggerKey: { organizationId, triggerKey: input.triggerKey },
      },
      create: {
        organizationId,
        triggerKey: input.triggerKey,
        enabled: input.enabled ?? true,
        sendAsDraft: input.sendAsDraft ?? false,
        templateId: input.templateId ?? null,
      },
      update: updateData,
    });

    revalidatePath("/settings");
    revalidatePath("/settings/triggers");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save trigger." };
  }
}

// Active EmailTemplates for a given trigger key, ordered by sortOrder
// then most-recently-updated (matches the default lookup precedence in
// loadTriggeredTemplate so the selector "system default" row matches
// what would fire without an override).
export async function getTemplatesForTrigger(
  triggerKey: string,
): Promise<TemplateOption[]> {
  const auth = await requireSession();
  if (auth !== true) return [];

  const rows = await prisma.emailTemplate.findMany({
    where: { trigger: triggerKey, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    select: { id: true, name: true },
  });
  return rows;
}
