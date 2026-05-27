import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BrandingView, type BrandingInitial } from "@/app/settings/branding-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getUserBrandingProfile, renderSignatureHtml, renderSignatureText } from "@/lib/signature";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // Branding profile pulls the signed-in user's UserProfile (with
  // default-logo fallback from /public/brand/) and shapes it for the
  // client component. Without a session the section can't render —
  // matches the old behavior where the CollapsibleSection was simply
  // omitted when brandingInitial was null.
  const session = await getServerSession(authOptions);
  let brandingInitial: BrandingInitial | null = null;
  let signaturePreviewHtml = "";
  let signaturePreviewText = "";
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
      // Render the actual signature HTML on the server using the same
      // function /reply and /send go through, so the preview block
      // matches inbox-rendered output exactly. Plain-text variant is
      // the clipboard fallback so paste-into-non-HTML targets (e.g.
      // a plain-text email composer) still get something readable.
      signaturePreviewHtml = renderSignatureHtml(profile);
      signaturePreviewText = renderSignatureText(profile);
    }
  }

  if (!brandingInitial) {
    return (
      <CollapsibleSection
        id="branding"
        title="Branding & Signature"
        description="Used on every email you send from Ace."
      >
        <p className="text-sm text-court-fg-muted">Sign in to manage your branding.</p>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection
      id="branding"
      title="Branding & Signature"
      description="Used on every email you send from Ace."
    >
      <BrandingView
        initial={brandingInitial}
        signaturePreviewHtml={signaturePreviewHtml}
        signaturePreviewText={signaturePreviewText}
      />
    </CollapsibleSection>
  );
}
