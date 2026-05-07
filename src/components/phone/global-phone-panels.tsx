"use client";

import { usePhonePanels } from "@/lib/phone-panels-context";
import { NewTextPanel, CallPanel, DialPadModal } from "@/app/phone/phone-view";

// Global mount for the floating New-Text and Call panels. Lives in
// Providers (above the route tree) so the Compose FAB — which fires
// usePhonePanels().openText / openCall — actually has a renderer to
// land in regardless of which page the recruiter is on. Previously
// the panels were mounted inside /phone's PhoneView only; off-route
// the FAB would set state but show nothing, looking like a regression
// where the picker disappeared with no place to type.
//
// /phone still registers its loadThreads via setAfterSend so a send
// from any route refreshes the thread list when /phone is open.
export function GlobalPhonePanels() {
  const phonePanels = usePhonePanels();
  return (
    <>
      {phonePanels.textOpen && (
        <NewTextPanel
          contact={phonePanels.contact}
          onClose={phonePanels.closeText}
          onSwitchToCall={phonePanels.switchToCall}
          onSent={phonePanels.triggerAfterSend}
        />
      )}
      {phonePanels.callOpen && (
        <CallPanel
          contact={phonePanels.contact}
          onClose={phonePanels.closeCall}
          onSwitchToText={phonePanels.switchToText}
        />
      )}
      {phonePanels.dialPadOpen && (
        <DialPadModal onClose={phonePanels.closeDialPad} />
      )}
    </>
  );
}
