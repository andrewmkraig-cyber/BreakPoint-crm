import { CourtModeView } from "@/app/settings/court-mode-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";

export const dynamic = "force-dynamic";

export default function AppearanceSettingsPage() {
  return (
    <CollapsibleSection
      id="appearance"
      title="Court Mode"
      description="Pick the palette Ace renders with. Persists per browser via localStorage and flips instantly."
    >
      <CourtModeView />
    </CollapsibleSection>
  );
}
