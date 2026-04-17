import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureDefaultTemplates();

  const templates = await prisma.emailTemplate.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    body: t.body,
    trigger: t.trigger,
    audience: t.audience,
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Email templates for submittals, candidate confirmations, and other repeat-send notes."
      />

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">Email templates</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Reusable subject + body you can drop into any email you send from Ace. Use
              {" "}<code className="rounded bg-muted px-1 py-0.5 text-[10px] text-navy">{"{{variable_name}}"}</code> for placeholders.
            </p>
          </div>
        </div>
        <TemplatesView initial={rows} />
      </section>
    </div>
  );
}
