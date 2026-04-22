import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import { PreferencesView } from "@/app/settings/preferences-view";
import { CourtModeView } from "@/app/settings/court-mode-view";
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
    category: t.category,
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

      <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-serif text-lg font-semibold text-court-fg">Court Mode</h2>
          <p className="mt-1 text-xs text-court-fg-muted">
            Pick the palette Ace renders with. Persists per browser via localStorage and flips
            instantly — no reload needed. Per-component theming lands surface by surface;
            today only Settings consumes the court-* tokens.
          </p>
        </div>
        <CourtModeView />
      </section>

      <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-serif text-lg font-semibold text-court-fg">Preferences</h2>
          <p className="mt-1 text-xs text-court-fg-muted">
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

      <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-serif text-lg font-semibold text-court-fg">Email templates</h2>
            <p className="mt-1 text-xs text-court-fg-muted">
              Reusable subject + body you can drop into any email you send from Ace. Use the
              {" "}<span className="rounded bg-court-surface-subtle px-1 py-0.5 text-[10px] font-semibold text-court-fg">Insert Field</span> picker in the editor to add merge fields like
              {" "}<code className="rounded bg-court-surface-subtle px-1 py-0.5 text-[10px] text-court-fg">[Candidate First Name]</code>.
            </p>
          </div>
        </div>
        <TemplatesView initial={rows} />
      </section>
    </div>
  );
}
