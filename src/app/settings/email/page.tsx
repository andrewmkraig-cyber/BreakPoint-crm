import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { EmailPreferencesView } from "@/app/settings/preferences-view";
import { CollapsibleSection } from "@/components/settings/collapsible-section";
import { ensureDefaultPreferences, getAppPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  await ensureDefaultPreferences();
  const [session, prefs] = await Promise.all([
    getServerSession(authOptions),
    getAppPreferences(),
  ]);

  const myEmail = session?.user?.email ?? "";
  const myPhone =
    prefs.recruiterPhones[myEmail] ??
    prefs.recruiterPhones[myEmail.toLowerCase()] ??
    "";
  const mySignature =
    prefs.emailSignatures[myEmail] ??
    prefs.emailSignatures[myEmail.toLowerCase()] ??
    prefs.emailSignatures["andrew@breakpointtalent.com"] ??
    "";

  return (
    <CollapsibleSection
      id="email"
      title="Email Preferences"
      description="Send-time triggers, recruiter phone, and the auto-appended signature."
    >
      <EmailPreferencesView
        autoSend={prefs.autoSendCandidateConfirmation}
        myPhone={myPhone}
        mySignature={mySignature}
        myEmail={myEmail}
      />
    </CollapsibleSection>
  );
}
