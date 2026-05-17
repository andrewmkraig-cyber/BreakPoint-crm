import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { TriggersView } from "@/app/settings/triggers-view";
import {
  getTriggerRules,
  getTemplatesForTrigger,
} from "@/app/settings/triggers-actions";

export const dynamic = "force-dynamic";

export default async function TriggersSettingsPage() {
  await ensureDefaultPreferences();
  const prefs = await getAppPreferences();
  const rules = await getTriggerRules();
  // Pre-fetch template options for every trigger so the dropdown is
  // populated on initial render without an extra round-trip per row.
  const templateOptionsByKey = Object.fromEntries(
    await Promise.all(
      rules.map(async (r) => [r.triggerKey, await getTemplatesForTrigger(r.triggerKey)] as const),
    ),
  );

  return (
    <CollapsibleSection
      id="triggers"
      eyebrow="Automation"
      title="Triggers"
      description="Automatic sends and event-driven actions Ace fires on your behalf."
    >
      <TriggersView
        autoSendCandidateConfirmation={prefs.autoSendCandidateConfirmation}
        rules={rules}
        templateOptionsByKey={templateOptionsByKey}
      />
    </CollapsibleSection>
  );
}
