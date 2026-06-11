import { NotificationPreferencesView } from "@/app/settings/preferences-view";
import { NotificationSoundsView } from "@/app/settings/sounds-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNotifPrefsForEmail } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const session = await getServerSession(authOptions);
  const notifPrefs = await getNotifPrefsForEmail(session?.user?.email);
  return (
    <CollapsibleSection
      id="notifications"
      title="Notification Preferences"
      description="In-app popups + desktop alerts + sounds for new mail, calls, and texts."
    >
      <NotificationPreferencesView
        initialMailEnabled={notifPrefs.mail}
        initialPhoneEnabled={notifPrefs.phone}
      />
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
