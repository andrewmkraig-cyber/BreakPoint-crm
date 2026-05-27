import { PersonalInfoView } from "@/app/settings/personal-info-view";
import { BrandingView, type BrandingInitial } from "@/app/settings/branding-view";
import {
  getPersonalInfo,
  getProfilePictureStatus,
} from "@/app/settings/personal-info-actions";
import {
  EMPTY_ADDRESS,
  type PersonalInfoRow,
} from "@/app/settings/personal-info-constants";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getUserBrandingProfile,
  renderSignatureHtml,
  renderSignatureText,
} from "@/lib/signature";

export const dynamic = "force-dynamic";

// Personal Info + Brand is one nav entry now. Personal info up top
// (avatar, birthday, address, t-shirt size) and branding below
// (signature fields, logo, signature preview + copy). Two separate
// CollapsibleSections so each form keeps its own Save button and
// description copy.
export default async function PersonalInfoSettingsPage() {
  const [initial, picture, session] = await Promise.all([
    getPersonalInfo(),
    getProfilePictureStatus(),
    getServerSession(authOptions),
  ]);

  const safeInitial: PersonalInfoRow = initial ?? {
    birthday: null,
    workAnniversary: null,
    address: { ...EMPTY_ADDRESS },
    tshirtSize: null,
  };

  // Branding profile mirrors what /settings/branding used to fetch —
  // resolves the signed-in user's UserProfile (with default-logo
  // fallback) and renders the signature preview HTML / text on the
  // server so the copy button can hand inbox-faithful output to the
  // clipboard.
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
      signaturePreviewHtml = renderSignatureHtml(profile);
      signaturePreviewText = renderSignatureText(profile);
    }
  }

  return (
    <>
      <CollapsibleSection
        id="personal-info"
        title="Personal Info"
        description="Your birthday, address, and t-shirt size, saved per user."
      >
        <PersonalInfoView
          initial={safeInitial}
          picture={picture}
          displayName={session?.user?.name ?? session?.user?.email ?? "You"}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="branding"
        title="Branding & Signature"
        description="Used on every email you send from Ace."
      >
        {brandingInitial ? (
          <BrandingView
            initial={brandingInitial}
            signaturePreviewHtml={signaturePreviewHtml}
            signaturePreviewText={signaturePreviewText}
          />
        ) : (
          <p className="text-sm text-court-fg-muted">Sign in to manage your branding.</p>
        )}
      </CollapsibleSection>
    </>
  );
}
