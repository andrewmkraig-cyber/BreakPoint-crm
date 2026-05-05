import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  await Promise.all([ensureDefaultTemplates(), ensureDefaultPreferences()]);

  const [templates, prefs] = await Promise.all([
    prisma.emailTemplate.findMany({
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    }),
    getAppPreferences(),
  ]);

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    trigger: t.trigger,
    audience: t.audience,
    category: t.category,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <CollapsibleSection
      id="templates"
      title="Templates/Triggers"
      description="Reusable subject + body, plus the automatic send-on-submittal toggle."
    >
      <TemplatesView
        initial={rows}
        autoSendCandidateConfirmation={prefs.autoSendCandidateConfirmation}
      />
    </CollapsibleSection>
  );
}
