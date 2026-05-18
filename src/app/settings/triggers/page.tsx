import { getServerSession } from "next-auth";

import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { authOptions } from "@/lib/auth";
import { getGmailStatus } from "@/lib/connectors";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";
import { TriggersView } from "@/app/settings/triggers-view";
import {
  getTriggerRules,
  getTemplatesForTrigger,
} from "@/app/settings/triggers-actions";

export const dynamic = "force-dynamic";

export default async function TriggersSettingsPage() {
  await ensureDefaultPreferences();
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const prefs = await getAppPreferences();
  const rules = await getTriggerRules();
  // Pre-fetch template options for every trigger so the dropdown is
  // populated on initial render without an extra round-trip per row.
  const [templateOptionsEntries, gmailStatus] = await Promise.all([
    Promise.all(
      rules.map(async (r) => [r.triggerKey, await getTemplatesForTrigger(r.triggerKey)] as const),
    ),
    getGmailStatus(sessionUserId),
  ]);
  const templateOptionsByKey = Object.fromEntries(templateOptionsEntries);
  const gmailConnected = gmailStatus.state === "connected";

  return (
    <CollapsibleSection
      id="triggers"
      title="Triggers"
      description="Automatic sends and event-driven actions Ace fires on your behalf."
    >
      <TriggersView
        autoSendCandidateConfirmation={prefs.autoSendCandidateConfirmation}
        rules={rules}
        templateOptionsByKey={templateOptionsByKey}
        gmailConnected={gmailConnected}
      />
    </CollapsibleSection>
  );
}
