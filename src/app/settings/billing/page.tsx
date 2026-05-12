import { getBillingSettings } from "@/lib/billing-settings";
import { CollapsibleSection } from "@/components/settings/collapsible-section";

import { BillingSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage() {
  const settings = await getBillingSettings();
  return (
    <CollapsibleSection
      id="billing"
      title="Billing"
      description="Identity on every invoice PDF + email. Bank details live inside the PDF — no pay links."
    >
      <BillingSettingsForm initial={settings} />
    </CollapsibleSection>
  );
}
