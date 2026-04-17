import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import { PreferencesView } from "@/app/settings/preferences-view";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await Promise.all([ensureDefaultTemplates(), ensureDefaultPreferences()]);

  const [session, templates, prefs] = await Promise.all([
    getServerSession(authOptions),
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
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  }));

  const myEmail = session?.user?.email ?? "";
  const myPhone = prefs.recruiterPhones[myEmail] ?? prefs.recruiterPhones[myEmail.toLowerCase()] ?? "";
  const mySignature =
    prefs.emailSignatures[myEmail] ??
    prefs.emailSignatures[myEmail.toLowerCase()] ??
    prefs.emailSignatures["andrew@breakpointtalent.com"] ??
    "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Preferences and reusable email templates for submittals and candidate notifications."
      />

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-serif text-lg font-semibold text-navy">Preferences</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Controls how Ace behaves around email delivery.
          </p>
        </div>
        <PreferencesView
          autoSend={prefs.autoSendCandidateConfirmation}
          myPhone={myPhone}
          mySignature={mySignature}
          myEmail={myEmail}
        />
      </section>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-navy">Email templates</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Reusable subject + body you can drop into any email you send from Ace. Use the
              {" "}<span className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-navy">Insert Field</span> picker in the editor to add merge fields like
              {" "}<code className="rounded bg-muted px-1 py-0.5 text-[10px] text-navy">[Candidate First Name]</code>.
            </p>
          </div>
        </div>
        <TemplatesView initial={rows} />
      </section>
    </div>
  );
}
