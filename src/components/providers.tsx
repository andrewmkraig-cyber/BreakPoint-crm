"use client";

import { SessionProvider } from "next-auth/react";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import {
  getStoredToastStackDir,
  TOAST_PREFS_CHANGED_EVENT,
  type ToastStackDir,
} from "@/lib/toast-prefs";
import { ToastStackControls } from "@/components/toast-stack-controls";
import { MinimizedDraftsProvider } from "@/lib/minimized-drafts-context";
import { ComposerManagerProvider } from "@/lib/composer-manager";
import { FloatingThreadProvider } from "@/lib/floating-thread-context";
import { PhonePanelsProvider } from "@/lib/phone-panels-context";
import { FindMatchesProvider } from "@/lib/find-matches-context";
import { ClaudePanelProvider } from "@/lib/claude-panel-context";
import { CalendarDrawerProvider } from "@/lib/calendar-drawer-context";
import { YouTubePanelProvider } from "@/components/youtube-panel/YouTubePanelProvider";
import { SpotifyPanelProvider } from "@/components/spotify-panel/SpotifyPanelProvider";
import { MinimizedTray } from "@/components/composer/minimized-tray";
import { FloatingThreadWindow } from "@/components/mail/floating-thread-window";
import { GlobalPhonePanels } from "@/components/phone/global-phone-panels";
import { FindMatchesPanel } from "@/components/game-plan/find-matches-panel";
import { ClaudePanel } from "@/components/claude-panel/ClaudePanel";
import { YouTubePanel } from "@/components/youtube-panel/YouTubePanel";
import { SpotifyPanel } from "@/components/spotify-panel/SpotifyPanel";
import { GlobalCalendarDrawer } from "@/components/calendar/global-calendar-drawer";

// ComposeFAB used to mount here as a portal-style fixed FAB. It now
// lives inside TopBar (left of the user info cluster) so it can't
// overlap the page footer block + so its tooltip / popover have room
// against the right edge.

export function Providers({ children }: { children: ReactNode }) {
  // Stack direction drives the Toaster's anchor corner (standard =
  // bottom-right, stack up = top-right). Read from localStorage on mount
  // and kept live via the prefs-changed event so the Settings toggle
  // applies without a reload.
  const [stackDir, setStackDir] = useState<ToastStackDir>("standard");
  useEffect(() => {
    const sync = () => setStackDir(getStoredToastStackDir());
    sync();
    window.addEventListener(TOAST_PREFS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TOAST_PREFS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toastPosition = stackDir === "up" ? "top-right" : "bottom-right";

  return (
    <SessionProvider>
      <MinimizedDraftsProvider>
        <ComposerManagerProvider>
          <FloatingThreadProvider>
            <PhonePanelsProvider>
              <FindMatchesProvider>
                <ClaudePanelProvider>
                  <CalendarDrawerProvider>
                    <YouTubePanelProvider>
                      <SpotifyPanelProvider>
                        {children}
                        <MinimizedTray />
                        <FloatingThreadWindow />
                        <GlobalPhonePanels />
                        <FindMatchesPanel />
                        <ClaudePanel />
                        <GlobalCalendarDrawer />
                        <YouTubePanel />
                        <SpotifyPanel />
                        <Toaster
                          position={toastPosition}
                          richColors
                          closeButton
                          toastOptions={{
                            style: {
                              fontFamily:
                                "var(--font-inter), system-ui, sans-serif",
                            },
                          }}
                        />
                        <ToastStackControls stackDir={stackDir} />
                      </SpotifyPanelProvider>
                    </YouTubePanelProvider>
                  </CalendarDrawerProvider>
                </ClaudePanelProvider>
              </FindMatchesProvider>
            </PhonePanelsProvider>
          </FloatingThreadProvider>
        </ComposerManagerProvider>
      </MinimizedDraftsProvider>
    </SessionProvider>
  );
}
