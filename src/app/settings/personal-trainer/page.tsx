import { PersonalTrainerView } from "@/app/settings/personal-trainer-view";
import {
  getRules,
  seedDefaultRules,
} from "@/app/settings/personal-trainer-actions";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

export default async function PersonalTrainerSettingsPage() {
  // Seed defaults on first load (idempotent — no-op if the org
  // already has rules), then fetch the current list.
  const org = await getCurrentOrg();
  await seedDefaultRules(org.id);
  const rules = await getRules(org.id);

  return (
    <CollapsibleSection
      id="personal-trainer"
      title="Personal Trainer"
      description="Standing rules injected into every Claude response across Ace."
    >
      <PersonalTrainerView orgId={org.id} initialRules={rules} />
    </CollapsibleSection>
  );
}
