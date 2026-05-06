"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { MinimizedDraftsProvider } from "@/lib/minimized-drafts-context";
import { ComposerManagerProvider } from "@/lib/composer-manager";
import { FloatingThreadProvider } from "@/lib/floating-thread-context";
import { PhonePanelsProvider } from "@/lib/phone-panels-context";
import { FindMatchesProvider } from "@/lib/find-matches-context";
import { ClaudePanelProvider } from "@/lib/claude-panel-context";
import { MinimizedTray } from "@/components/composer/minimized-tray";
import { FloatingThreadWindow } from "@/components/mail/floating-thread-window";
import { GlobalPhonePanels } from "@/components/phone/global-phone-panels";
import { FindMatchesPanel } from "@/components/game-plan/find-matches-panel";
import { ClaudePanel } from "@/components/claude-panel/ClaudePanel";

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
              <FindMatchesProvider>
                <ClaudePanelProvider>
                  {children}
                  <MinimizedTray />
                  <FloatingThreadWindow />
                  <GlobalPhonePanels />
                  <FindMatchesPanel />
                  <ClaudePanel />
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
                </ClaudePanelProvider>
              </FindMatchesProvider>
            </PhonePanelsProvider>
          </FloatingThreadProvider>
        </ComposerManagerProvider>
      </MinimizedDraftsProvider>
    </SessionProvider>
  );
}
