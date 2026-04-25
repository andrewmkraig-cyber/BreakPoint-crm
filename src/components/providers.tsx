"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { MinimizedDraftsProvider } from "@/lib/minimized-drafts-context";
import { ComposerManagerProvider } from "@/lib/composer-manager";
import { MinimizedTray } from "@/components/composer/minimized-tray";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <MinimizedDraftsProvider>
        <ComposerManagerProvider>
          {children}
          <MinimizedTray />
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
        </ComposerManagerProvider>
      </MinimizedDraftsProvider>
    </SessionProvider>
  );
}
