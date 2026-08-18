"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const REFRESH_THROTTLE_MS = 10_000;
const MOBILE_REFRESH_DELAY_MS = 900;
const DESKTOP_REFRESH_DELAY_MS = 120;
const PREFLIGHT_TIMEOUT_MS = 3_500;

function isMobileViewport(): boolean {
  return (
    window.matchMedia("(max-width: 767px)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

async function canReachAce(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    PREFLIGHT_TIMEOUT_MS,
  );
  try {
    const res = await fetch("/api/health", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

// Re-fetch the dashboard's server data when the user returns to the tab
// or refocuses the window. Andrew runs Ace as an always-open PWA, so a
// reminder/event created from the global FAB or the calendar should
// appear on the This Week widget the moment he switches back, not after
// a manual reload. Mobile PWAs can fire focus / pageshow / visibilitychange
// while WebKit is still restoring the network stack, so probe a tiny local
// endpoint before kicking Next's raw RSC refresh fetch.
export function DashboardAutoRefresh() {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const pendingTimer = useRef<number | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if ("onLine" in navigator && !navigator.onLine) return;
      const now = Date.now();
      if (now - lastRefresh.current < REFRESH_THROTTLE_MS) return;
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
      }
      pendingTimer.current = window.setTimeout(
        () => {
          pendingTimer.current = null;
          void canReachAce().then((ok) => {
            if (!ok) return;
            lastRefresh.current = Date.now();
            router.refresh();
          });
        },
        isMobileViewport() ? MOBILE_REFRESH_DELAY_MS : DESKTOP_REFRESH_DELAY_MS,
      );
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
      }
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}
