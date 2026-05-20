"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// Re-fetch the dashboard's server data when the user returns to the tab
// or refocuses the window. Andrew runs Ace as an always-open PWA, so a
// reminder/event created from the global FAB or the calendar should
// appear on the This Week widget the moment he switches back, not after
// a manual reload. Throttled so the focus + visibilitychange pair that
// both fire on a single tab switch only refresh once.
export function DashboardAutoRefresh() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefresh.current < 3000) return;
      lastRefresh.current = now;
      router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}
