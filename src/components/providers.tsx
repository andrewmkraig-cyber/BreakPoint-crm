"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { MinimizedDraftsProvider } from "@/lib/minimized-drafts-context";
import { ComposerManagerProvider } from "@/lib/composer-manager";
import { FloatingThreadProvider } from "@/lib/floating-thread-context";
import { MinimizedTray } from "@/components/composer/minimized-tray";
import { FloatingThreadWindow } from "@/components/mail/floating-thread-window";
import { ComposeFAB } from "@/components/mail/compose-fab";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <MinimizedDraftsProvider>
        <ComposerManagerProvider>
          <FloatingThreadProvider>
            {children}
            <MinimizedTray />
            <FloatingThreadWindow />
            <ComposeFAB />
            <Toaster
              position="bottom-right"
              richColors
              closeButton
              toastOptions={{
                style: {
                  fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
                },
              }}
            />
          </FloatingThreadProvider>
        </ComposerManagerProvider>
      </MinimizedDraftsProvider>
    </SessionProvider>
  );
}
