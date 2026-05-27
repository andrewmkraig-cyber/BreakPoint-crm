"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  TRIGGER_OPTIONS,
  type TriggerAudience,
  type TriggerDispatch,
} from "@/app/settings/template-constants";

export type TriggerRuleRow = {
  triggerKey: string;
  label: string;
  description: string;
  enabled: boolean;
  sendAsDraft: boolean;
  templateId: string | null;
  templateName: string | null;
  // True when these values come from a real TriggerRule row; false when
  // they're synthesized defaults because no row exists yet. The UI uses
  // this to render a "Customized for your org" vs "System default" pill
  // and to enable the Reset-to-default action only when there's a row
  // to delete.
  hasRule: boolean;
  // Built-in metadata threaded through from TRIGGER_OPTIONS so the
  // Triggers tab can render real "Event" / "Audience" / "Dispatch"
  // fields instead of scraping the description prose. None of these
  // are editable — they identify the built-in event that fires this
  // trigger from a code call-site.
  audience: TriggerAudience;
  eventName: string;
  dispatch: TriggerDispatch;
};

export type TemplateOption = {
  id: string;
  name: string;
  // True when this template's `trigger` column matches the trigger
  // key the dropdown belongs to. UI renders a "Tagged for this trigger"
  // suffix on these rows + sorts them to the top so the recruiter can
  // see which template the "System default" fallback would land on.
  matchesTrigger: boolean;
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
      audience: t.audience,
      eventName: t.eventName,
      dispatch: t.dispatch,
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
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save trigger." };
  }
}

// Active EmailTemplates for the trigger-override dropdown. Returns
// EVERY active template, not just the trigger-tagged subset, so a
// recruiter who never wired `template.trigger` to a specific
// pipeline key can still pick any template as the override. Templates
// that ARE tagged for this trigger are flagged with matchesTrigger:
// true and sorted to the top so the relationship stays legible.
export async function getTemplatesForTrigger(
  triggerKey: string,
): Promise<TemplateOption[]> {
  const auth = await requireSession();
  if (auth !== true) return [];

  const rows = await prisma.emailTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    select: { id: true, name: true, trigger: true },
  });
  const options: TemplateOption[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    matchesTrigger: r.trigger === triggerKey,
  }));
  // Stable sort: matched-first, otherwise keep the existing sortOrder /
  // updatedAt ordering from the Prisma query.
  options.sort((a, b) => {
    if (a.matchesTrigger === b.matchesTrigger) return 0;
    return a.matchesTrigger ? -1 : 1;
  });
  return options;
}

// Reset-to-default: remove the per-org TriggerRule override row so the
// trigger reverts to the system default (most-recently-updated active
// template matching the trigger key, send mode per caller). The
// built-in trigger itself is code-emitted from a fixed call-site and
// cannot be removed; this action only deletes the customization.
//
// Returns ok=true even if no row existed (idempotent: already at
// default). validKeys gate matches upsertTriggerRule so a stale
// client can't poke at unknown keys.
export async function deleteTriggerRule(input: {
  triggerKey: string;
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
    // deleteMany (not delete) so the no-row case is a no-op instead of
    // throwing P2025. Recruiter clicking Reset-to-default twice in a
    // row shouldn't surface an error.
    await prisma.triggerRule.deleteMany({
      where: { organizationId, triggerKey: input.triggerKey },
    });
    revalidatePath("/settings");
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reset trigger." };
  }
}
