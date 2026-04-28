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

      {/* Top row — Court Mode and Notification Preferences sit side by
          side on lg+; stack on smaller screens. Both surfaces are
          self-contained client components, so the grid only handles
          layout. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CollapsibleSection
          title="Court Mode"
          description="Pick the palette Ace renders with. Persists per browser via localStorage and flips instantly — no reload needed."
        >
          <CourtModeView />
        </CollapsibleSection>

        <CollapsibleSection
          title="Notification Preferences"
          description="In-app popups for new mail, calls, and texts. Style picker recolors with Court Mode automatically (Ink stays dark)."
        >
          <NotificationPreferencesView />
        </CollapsibleSection>
      </div>

      <CollapsibleSection
        title="Email Preferences"
        description="Send-time triggers, recruiter phone, and the auto-appended signature block."
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
          title="Branding & Signature"
          description="Used as the signature block on every email you send from Ace — Mail Tab replies, submittals, candidate confirmations. Stored per user; never shared across the org."
        >
          <BrandingView initial={brandingInitial} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Email templates"
        description="Reusable subject + body you can drop into any email you send from Ace. Use the Insert Field picker in the editor to add merge fields like [Candidate First Name]."
      >
        <TemplatesView initial={rows} />
      </CollapsibleSection>
    </div>
  );
}
