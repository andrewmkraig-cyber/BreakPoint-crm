import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { TriggersView } from "@/app/settings/triggers-view";

export const dynamic = "force-dynamic";

export default async function TriggersSettingsPage() {
  await ensureDefaultPreferences();
  const prefs = await getAppPreferences();

  return (
    <CollapsibleSection
      id="triggers"
      title="Triggers"
      description="Automatic sends and event-driven actions Ace fires on your behalf."
    >
      <TriggersView autoSendCandidateConfirmation={prefs.autoSendCandidateConfirmation} />
    </CollapsibleSection>
  );
}
