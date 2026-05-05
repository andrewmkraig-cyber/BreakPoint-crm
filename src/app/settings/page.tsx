import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { ensureDefaultTemplates } from "@/app/settings/templates-actions";
import { TemplatesView, type TemplateRow } from "@/app/settings/templates-view";
import {
  EmailPreferencesView,
  NotificationPreferencesView,
} from "@/app/settings/preferences-view";
import { CourtModeView } from "@/app/settings/court-mode-view";
import { BrandingView, type BrandingInitial } from "@/app/settings/branding-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { SettingsTocLink } from "@/components/settings/toc-link";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { getUserBrandingProfile } from "@/lib/signature";
import { ConnectorsView } from "@/app/settings/connectors-view";
import { NotificationSoundsView } from "@/app/settings/sounds-view";
import { getAllConnectorStatuses } from "@/lib/connectors";
import { PersonalTrainerView } from "@/app/settings/personal-trainer-view";
import {
  getRules,
  seedDefaultRules,
} from "@/app/settings/personal-trainer-actions";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

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

  // Ace 28.0: Connector statuses are computed server-side once per
  // page load — Gmail hits Google's token endpoint, Claude + Quo each
  // ping a cheap health URL. The three checks run in parallel inside
  // getAllConnectorStatuses so the slowest one bounds total latency
  // instead of the sum.
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const connectors = await getAllConnectorStatuses(sessionUserId);

  // Personal Trainer: seed defaults on first load (idempotent — no-op
  // if the org already has rules), then fetch the current list to hand
  // to the client view.
  const org = await getCurrentOrg();
  await seedDefaultRules(org.id);
  const personalTrainerRules = await getRules(org.id);

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

  const SECTIONS = [
    { id: "appearance",        label: "Appearance" },
    { id: "notifications",     label: "Notifications" },
    { id: "connectors",        label: "Connectors" },
    { id: "email",             label: "Email" },
    { id: "branding",          label: "Branding" },
    { id: "templates",         label: "Templates" },
    { id: "personal-trainer",  label: "Personal Trainer" },
  ];

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="lg:hidden">
        <PageHeader
          eyebrow="Admin"
          title="Settings"
          description="Preferences and reusable email templates."
        />
      </div>

      {/* LEFT RAIL — sticky TOC */}
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:w-56 lg:shrink-0">
        <div className="mb-6 border-b border-court-border pb-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-court-accent-dark">
            Admin
          </div>
          <h1 className="mt-1 font-serif text-2xl font-semibold text-court-fg">
            Settings
          </h1>
        </div>
        <nav className="space-y-0.5">
          {SECTIONS.map((s) => (
            <SettingsTocLink
              key={s.id}
              targetId={s.id}
              className="block rounded-lg px-3 py-2 text-sm font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            >
              {s.label}
            </SettingsTocLink>
          ))}
        </nav>
      </aside>

      {/* RIGHT COLUMN — section stack. Each CollapsibleSection now takes an `id` prop (Edit 2 adds support). */}
      <div className="min-w-0 flex-1 space-y-6">
        <CollapsibleSection
          id="appearance"
          title="Court Mode"
          description="Pick the palette Ace renders with. Persists per browser via localStorage and flips instantly."
        >
          <CourtModeView />
        </CollapsibleSection>

        <CollapsibleSection
          id="notifications"
          title="Notification Preferences"
          description="In-app popups + sounds for new mail, calls, and texts."
        >
          <NotificationPreferencesView />
          <div className="mt-5 border-t border-court-border pt-5">
            <div className="mb-3">
              <div className="text-sm font-semibold text-court-fg">Notification sounds</div>
              <div className="mt-0.5 text-xs text-court-fg-muted">
                Pick a sound for new mail and another for texts/calls.
              </div>
            </div>
            <NotificationSoundsView />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="connectors"
          title="Connectors"
          description="Live health of Gmail, Claude, and Quo."
        >
          <ConnectorsView gmail={connectors.gmail} claude={connectors.claude} quo={connectors.quo} />
        </CollapsibleSection>

        <CollapsibleSection
          id="email"
          title="Email Preferences"
          description="Send-time triggers, recruiter phone, and the auto-appended signature."
        >
          <EmailPreferencesView
            autoSend={prefs.autoSendCandidateConfirmation}
            myPhone={myPhone}
            mySignature={mySignature}
            myEmail={myEmail}
          />
        </CollapsibleSection>

        {brandingInitial && (
          <CollapsibleSection
            id="branding"
            title="Branding & Signature"
            description="Used on every email you send from Ace."
          >
            <BrandingView initial={brandingInitial} />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          id="templates"
          title="Email templates"
          description="Reusable subject + body. Use the Insert Field picker to add merge fields."
        >
          <TemplatesView initial={rows} />
        </CollapsibleSection>

        <CollapsibleSection
          id="personal-trainer"
          title="Personal Trainer"
          description="Standing rules injected into every Claude response across Ace."
        >
          <PersonalTrainerView orgId={org.id} initialRules={personalTrainerRules} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
