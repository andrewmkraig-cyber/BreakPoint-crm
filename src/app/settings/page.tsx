import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import { PreferencesView } from "@/app/settings/preferences-view";
import { CourtModeView } from "@/app/settings/court-mode-view";
import { BrandingView, type BrandingInitial } from "@/app/settings/branding-view";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { getUserBrandingProfile } from "@/lib/signature";

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

  // Branding profile for the new Branding & Signature section. Pulls
  // the signed-in user's UserProfile (with default-logo fallback from
  // /public/brand/) and shapes it for the client component.
  let brandingInitial: BrandingInitial | null = null;
  if (session?.user?.email) {
    const userRow = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (userRow) {
      const profile = await getUserBrandingProfile(userRow.id);
      brandingInitial = {
        email: profile.email,
        fullName: profile.fullName,
        jobTitle: profile.jobTitle,
        phone: profile.phone,
        website: profile.website,
        logoPreviewDataUri:
          profile.logoDataBase64.length > 0
            ? `data:${profile.logoMimeType};base64,${profile.logoDataBase64}`
            : "",
        hasCustomLogo: profile.hasCustomLogo,
      };
    }
  }

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

      {brandingInitial && (
        <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-serif text-lg font-semibold text-court-fg">Branding &amp; Signature</h2>
            <p className="mt-1 text-xs text-court-fg-muted">
              Used as the signature block on every email you send from Ace — Mail Tab replies,
              submittals, candidate confirmations. Stored per user; never shared across the org.
            </p>
          </div>
          <BrandingView initial={brandingInitial} />
        </section>
      )}

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
