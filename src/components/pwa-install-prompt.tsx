"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isStandalone = window.matchMedia(
      "(display-mode: standalone)",
    ).matches;
    if (isStandalone) return;
    if (window.innerWidth >= 768) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (!visible) return null;

  const handleInstall = async () => {
    const deferred = deferredRef.current;
    if (!deferred) {
      setVisible(false);
      return;
    }
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      deferredRef.current = null;
      setVisible(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install Ace"
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl bg-court-surface shadow-lg p-4"
    >
      <p className="flex-1 text-sm text-court-fg">
        Install Ace for faster access
      </p>
      <Button variant="primary" size="sm" onClick={handleInstall}>
        Install
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss install prompt"
        onClick={() => setVisible(false)}
      >
        ×
      </Button>
    </div>
  );
}
