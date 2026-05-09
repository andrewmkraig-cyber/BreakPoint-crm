import { PersonalInfoView } from "@/app/settings/personal-info-view";
import { getPersonalInfo } from "@/app/settings/personal-info-actions";
import type { PersonalInfoRow } from "@/app/settings/personal-info-constants";
import { CollapsibleSection } from "@/components/settings/collapsible-section";

export const dynamic = "force-dynamic";

export default async function PersonalInfoSettingsPage() {
  const initial: PersonalInfoRow = (await getPersonalInfo()) ?? {
    birthday: null,
    address: null,
    tshirtSize: null,
  };

  return (
    <CollapsibleSection
      id="personal-info"
      title="Personal Info"
      description="Your birthday, address, and t-shirt size — saved per user."
    >
      <PersonalInfoView initial={initial} />
    </CollapsibleSection>
  );
}
