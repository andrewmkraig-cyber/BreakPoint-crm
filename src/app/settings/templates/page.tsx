import { getServerSession } from "next-auth";

import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getGmailStatus } from "@/lib/connectors";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import {
  getTriggerRules,
  getTemplatesForTrigger,
} from "@/app/settings/triggers-actions";
import { TemplatesTriggersView } from "@/app/settings/templates-triggers-view";
import { BulkSendSettingsView } from "@/app/settings/bulk-send-settings-view";
import type { TemplateRow, TemplateUsage } from "@/app/settings/templates-view";

export const dynamic = "force-dynamic";

// Unified Templates + Triggers settings surface. Replaces the old split
// between /settings/templates and /settings/triggers - both now render
// here behind an internal TabStrip. /settings/triggers is kept as a
// redirect so deep links survive.
export default async function TemplatesTriggersSettingsPage() {
  await ensureDefaultTemplates();
  await ensureDefaultPreferences();

  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [templates, prefs, rules, gmailStatus] = await Promise.all([
    prisma.emailTemplate.findMany({
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    }),
    getAppPreferences(),
    getTriggerRules(),
    getGmailStatus(sessionUserId),
  ]);

  // Pre-fetch template options per trigger key so the dropdowns
  // populate on initial render - same shape the old triggers page used.
  const templateOptionsEntries = await Promise.all(
    rules.map(async (r) => [r.triggerKey, await getTemplatesForTrigger(r.triggerKey)] as const),
  );
  const templateOptionsByKey = Object.fromEntries(templateOptionsEntries);

  // Reverse-index: for each templateId, which trigger(s) point at it?
  // Drives the "Used by" badge on every template card.
  const usageByTemplate = new Map<string, TemplateUsage[]>();
  for (const r of rules) {
    if (!r.templateId) continue;
    const list = usageByTemplate.get(r.templateId) ?? [];
    list.push({ triggerKey: r.triggerKey, label: r.label });
    usageByTemplate.set(r.templateId, list);
  }

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    trigger: t.trigger,
    audience: t.audience,
    category: t.category,
    isActive: t.isActive,
    sendAsDraft: t.sendAsDraft,
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt.toISOString(),
    usedBy: usageByTemplate.get(t.id) ?? [],
  }));

  return (
    <div className="space-y-4">
      <CollapsibleSection
        id="templates"
        title="Templates + Triggers"
        description="Reusable email templates plus the pipeline triggers that fire them. Every Trigger row points at a Template; click a Used by badge to jump between them."
      >
        <TemplatesTriggersView
          templates={rows}
          rules={rules}
          templateOptionsByKey={templateOptionsByKey}
          autoSendCandidateConfirmation={prefs.autoSendCandidateConfirmation}
          gmailConnected={gmailStatus.state === "connected"}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="bulk-pacing"
        title="Bulk email pacing"
        description="How the &ldquo;Send to N candidates&rdquo; button spaces sends and caps daily volume, to protect deliverability."
      >
        <BulkSendSettingsView
          initialSpacing={prefs.bulkSendSpacingMinutes}
          initialDailyCap={prefs.bulkDailyCap}
        />
      </CollapsibleSection>
    </div>
  );
}
