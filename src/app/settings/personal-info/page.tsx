import { PersonalInfoView } from "@/app/settings/personal-info-view";
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

export const dynamic = "force-dynamic";

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

  return (
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
  );
}
