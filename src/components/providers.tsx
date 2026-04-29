"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { MinimizedDraftsProvider } from "@/lib/minimized-drafts-context";
import { ComposerManagerProvider } from "@/lib/composer-manager";
import { FloatingThreadProvider } from "@/lib/floating-thread-context";
import { PhonePanelsProvider } from "@/lib/phone-panels-context";
import { MinimizedTray } from "@/components/composer/minimized-tray";
import { FloatingThreadWindow } from "@/components/mail/floating-thread-window";
import { GlobalPhonePanels } from "@/components/phone/global-phone-panels";

// ComposeFAB used to mount here as a portal-style fixed FAB. It now
// lives inside TopBar (left of the user info cluster) so it can't
// overlap the page footer block + so its tooltip / popover have room
// against the right edge.

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <MinimizedDraftsProvider>
        <ComposerManagerProvider>
          <FloatingThreadProvider>
            <PhonePanelsProvider>
              {children}
              <MinimizedTray />
              <FloatingThreadWindow />
              <GlobalPhonePanels />
              <Toaster
                position="bottom-right"
                richColors
                closeButton
                toastOptions={{
                  style: {
                    fontFamily: "var(--font-inter), system-ui, sans-serif",
                  },
                }}
              />
            </PhonePanelsProvider>
          </FloatingThreadProvider>
        </ComposerManagerProvider>
      </MinimizedDraftsProvider>
    </SessionProvider>
  );
}
