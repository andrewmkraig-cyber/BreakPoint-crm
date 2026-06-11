import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { BulkSendSettingsView } from "@/app/settings/bulk-send-settings-view";

export const dynamic = "force-dynamic";

// Bulk email pacing settings. Split out of /settings/templates into its
// own category so deliverability controls (send spacing + daily cap)
// don't live buried under Templates + Triggers.
export default async function BulkEmailPacingSettingsPage() {
  await ensureDefaultPreferences();
  const prefs = await getAppPreferences();

  return (
    <CollapsibleSection
      id="bulk-pacing"
      title="Bulk email pacing"
      description="How the &ldquo;Send to N candidates&rdquo; button spaces sends and caps daily volume, to protect deliverability."
    >
      <BulkSendSettingsView
        initialSpacing={prefs.bulkSendSpacingMinutes}
        initialDailyCap={prefs.bulkDailyCap}
      />
    </CollapsibleSection>
  );
}
