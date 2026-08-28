"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { renderNewReplyToast, type NewReplyEvent } from "@/components/reply-notification-toast";

// Sidebar badge + new-reply toasts for Instantly replies.
//
// Deliberately mirrors MailProvider: same 15s cadence, same in-flight
// guard, same seed-on-first-poll behavior so opening Ace doesn't dump a
// toast for every unread reply already sitting there.
//
// This polls ACE's own database (/api/instantly/replies/unread), not
// Instantly. It costs zero against the 20/min /emails budget, so it can
// run continuously without competing with the Replies page or the cron.
//
// Confirmed auto-replies never appear here at all - the route filters
// them out server-side, so they can neither toast nor reach the badge.
//
// One thing here DOES cost an Instantly call: the focus handler below.
// Reading a thread in Instantly clears the Ace badge, and the cron that
// notices bounds that at 5 minutes - which is too slow for the case that
// actually happens, tabbing straight back to Ace from Instantly. So
// regaining focus asks the server to reconcile once. Both sides throttle
// it: this file at FOCUS_SYNC_MIN_INTERVAL_MS per tab, and the route
// itself in the database, which is the guard that actually holds when
// two Ace tabs are open.

const POLL_INTERVAL_MS = 15_000;

// Slightly above the route's own 45s floor, so the common case is a
// no-op here rather than a wasted round trip that comes back throttled.
const FOCUS_SYNC_MIN_INTERVAL_MS = 60_000;

type Summary = {
  // null = the server could not determine the count this tick. Keep the
  // last known value rather than zeroing the badge.
  count: number | null;
  enabled: boolean;
  latest: NewReplyEvent[];
};

type CampaignsContextValue = {
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  markReplyRead: (id: string) => void;
};

const CampaignsContext = createContext<CampaignsContextValue>({
  unreadCount: 0,
  refreshUnread: async () => {},
  markReplyRead: () => {},
});

export function CampaignsProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const inFlight = useRef(false);
  const seenIds = useRef<Set<string> | null>(null);
  const lastFocusSync = useRef(0);

  const fetchSummary = useCallback(async (): Promise<Summary | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      const res = await fetch("/api/instantly/replies/unread", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as Summary;
    } catch {
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const apply = useCallback((summary: Summary) => {
    if (typeof summary.count !== "number") return;
    setUnreadCount(summary.count);

    // First poll seeds the seen-set so pre-existing unread replies don't
    // all toast at once on page load.
    if (seenIds.current === null) {
      seenIds.current = new Set(summary.latest.map((r) => r.id));
      return;
    }

    const fresh = summary.latest.filter((r) => !seenIds.current!.has(r.id));
    for (const r of summary.latest) seenIds.current.add(r.id);
    if (fresh.length === 0) return;

    // Honor the notification toggle at fire time, so flipping it in
    // Settings takes effect without a reload.
    if (!summary.enabled) return;
    for (const r of fresh) renderNewReplyToast(r);
  }, []);

  const refreshUnread = useCallback(async () => {
    const summary = await fetchSummary();
    if (summary) apply(summary);
  }, [fetchSummary, apply]);

  const markReplyRead = useCallback((id: string) => {
    // Optimistic: drop the badge immediately, then persist. The next
    // poll reconciles if the write failed.
    setUnreadCount((c) => Math.max(0, c - 1));
    seenIds.current?.add(id);
    void fetch("/api/instantly/replies/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    }).catch(() => {});
  }, []);

  // Ask the server to reconcile Ace's unread state against Instantly's,
  // then re-read the badge. Fire-and-forget: if the reconcile fails or
  // comes back throttled, the badge just keeps its current value until
  // the cron catches it.
  const syncReadFromInstantly = useCallback(async () => {
    const now = Date.now();
    if (now - lastFocusSync.current < FOCUS_SYNC_MIN_INTERVAL_MS) return;
    lastFocusSync.current = now;
    try {
      await fetch("/api/instantly/replies/sync-read", { method: "POST" });
    } catch {
      // Offline or mid-deploy. Nothing to show the user - the badge is
      // unchanged and the next focus or the cron retries.
    }
    await refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    void refreshUnread();
    const id = window.setInterval(() => {
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshUnread]);

  // Coming back to the tab is the signal that you may have just been in
  // Instantly. `visibilitychange` covers the tab switch; `focus` covers
  // switching back to the browser window itself.
  useEffect(() => {
    function onReturn() {
      if (document.visibilityState !== "visible") return;
      void syncReadFromInstantly();
    }
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [syncReadFromInstantly]);

  return (
    <CampaignsContext.Provider value={{ unreadCount, refreshUnread, markReplyRead }}>
      {children}
    </CampaignsContext.Provider>
  );
}

export function useCampaignsContext(): CampaignsContextValue {
  return useContext(CampaignsContext);
}
