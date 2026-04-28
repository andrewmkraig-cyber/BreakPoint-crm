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

// Live-polling unread count for the sidebar Phone-tab badge. Mirrors
// MailContext's polling cadence + refresh semantics so the badge feels
// in lockstep with Mail's. Deliberately does NOT touch document.title
// (per spec — phone notifications stay in the sidebar only) and does
// NOT fire toasts on new inbound (that's wired separately via the
// existing /api/krispcall/recent toast feed if/when re-enabled).
//
// Phase 1: the count is always 0 because SmsMessage has no read field
// yet. The provider still polls so the wiring is in place — the
// moment read tracking ships, the count goes live with no client-side
// changes needed.

const POLL_INTERVAL_MS = 30_000;

type PhoneContextValue = {
  unreadCount: number;
  refreshUnread: () => Promise<void>;
};

const PhoneContext = createContext<PhoneContextValue | null>(null);

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const inFlightRef = useRef(false);

  const refreshUnread = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/phone/unread-count", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as
        | { count?: number }
        | null;
      if (typeof body?.count === "number") setUnreadCount(body.count);
    } catch {
      // Silent: badge stays at last-known count.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const id = window.setInterval(() => {
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    // Listen for thread-read broadcasts (e.g. quick reply from the
    // text toast) so the sidebar badge flips down immediately
    // instead of waiting for the next 30s poll.
    function onThreadRead() {
      void refreshUnread();
    }
    window.addEventListener("ace:phone-thread-read", onThreadRead);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("ace:phone-thread-read", onThreadRead);
    };
  }, [refreshUnread]);

  return (
    <PhoneContext.Provider value={{ unreadCount, refreshUnread }}>
      {children}
    </PhoneContext.Provider>
  );
}

export function usePhoneContext(): PhoneContextValue {
  const ctx = useContext(PhoneContext);
  if (!ctx) {
    // Defensive fallback (mirrors useMailContext): surfaces rendered
    // outside the provider get a static zero rather than a crash.
    return {
      unreadCount: 0,
      refreshUnread: async () => {},
    };
  }
  return ctx;
}
