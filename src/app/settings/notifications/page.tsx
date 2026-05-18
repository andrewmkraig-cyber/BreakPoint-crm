import { NotificationPreferencesView } from "@/app/settings/preferences-view";
import { NotificationSoundsView } from "@/app/settings/sounds-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { PushPermissionButton } from "@/components/push-permission-button";

export const dynamic = "force-dynamic";

export default function NotificationsSettingsPage() {
  return (
    <CollapsibleSection
      id="notifications"
      title="Notification Preferences"
      description="In-app popups + sounds for new mail, calls, and texts."
    >
      {/* Push notifications first — it's the only block here that
          actually has to be opted into per-device, so it shouldn't sit
          buried under preference + sound rows the recruiter is likely
          to skim past. */}
      <div className="mb-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-court-fg">
            Push notifications
          </div>
          <div className="mt-0.5 text-xs text-court-fg-muted">
            Get notified on this device when new mail, texts, or calls
            arrive, even when Ace isn&apos;t open.
          </div>
        </div>
        <PushPermissionButton />
      </div>
      <div className="border-t border-court-border pt-5">
        <NotificationPreferencesView />
      </div>
      <div className="mt-5 border-t border-court-border pt-5">
        <div className="mb-3">
          <div className="text-sm font-semibold text-court-fg">Notification sounds</div>
          <div className="mt-0.5 text-xs text-court-fg-muted">
            Pick a sound for new mail and another for texts/calls.
          </div>
        </div>
        <NotificationSoundsView />
      </div>
    </CollapsibleSection>
  );
}
