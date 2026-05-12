import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  await ensureDefaultTemplates();

  const templates = await prisma.emailTemplate.findMany({
    // Manual sortOrder drives display order; Active tab still groups
    // first via isActive desc so the count in the segmented control
    // matches the visible list.
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
  });

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    trigger: t.trigger,
    audience: t.audience,
    category: t.category,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <CollapsibleSection
      id="templates"
      title="Templates"
      description="Reusable subject + body. Use the Insert Field picker to add merge fields."
    >
      <TemplatesView initial={rows} />
    </CollapsibleSection>
  );
}
