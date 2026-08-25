import { CourtModeView } from "@/app/settings/court-mode-view";
import { SidebarTabsView } from "@/app/settings/sidebar-tabs-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";

export const dynamic = "force-dynamic";

export default function AppearanceSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <CollapsibleSection
        id="appearance"
        title="Court Mode"
        description="Pick the palette Ace renders with. Persists per browser via localStorage and flips instantly."
      >
        <CourtModeView />
      </CollapsibleSection>

      <CollapsibleSection
        id="sidebar-tabs"
        title="Sidebar Tabs"
        description="Choose which tabs show in the sidebar. Hiding a tab only removes the row - the page still works if you go straight to its URL. Clubhouse and Settings are always shown."
      >
        <SidebarTabsView />
      </CollapsibleSection>
    </div>
  );
}
