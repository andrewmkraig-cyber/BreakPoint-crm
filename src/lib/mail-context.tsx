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
import { renderNewMailToast } from "@/components/mail-notification-toast";

// Live-polling source of truth for the Mail Tab's "what's unread right
// now" state. Replaces the per-render server fetch the sidebar +
// tab-title used to do, so all surfaces (badge, title, toasts) move
// together every 30s without a hard refresh.
//
// The provider seeds itself from the server-rendered count passed in
// at app-shell mount, then overwrites that with each poll's payload.
// "New thread" detection is by id-set diff, not count delta — that
// way a thread arriving + another being read in the same window still
// surfaces a toast for the new one.

const POLL_INTERVAL_MS = 30_000;
const MAIL_NOTIFICATIONS_KEY = "ace_mail_notifications";

export type UnreadInboxThread = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  timestampIso: string | null;
};

type Summary = { count: number; latest: UnreadInboxThread[] };

type MailContextValue = {
  unreadCount: number;
  latestThreads: UnreadInboxThread[];
  refreshUnread: () => Promise<void>;
};

const MailContext = createContext<MailContextValue | null>(null);

export function MailProvider({
  initialUnreadCount,
  children,
}: {
  initialUnreadCount: number;
  children: ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [latestThreads, setLatestThreads] = useState<UnreadInboxThread[]>([]);

  // Tracks every unread thread id we've already seen (across all
  // polls, including the first one). New ids = unread threads that
  // weren't here last tick → those are the ones that fire a toast.
  // Initialized empty; seeded on the first successful poll so we
  // don't toast for everything already in the inbox at app open.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const inFlightRef = useRef(false);

  const fetchSummary = useCallback(async (): Promise<Summary | null> => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/mail/unread", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as Summary;
    } catch {
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const apply = useCallback((summary: Summary) => {
    setUnreadCount(summary.count);
    setLatestThreads(summary.latest);
    const incomingIds = new Set(summary.latest.map((t) => t.id));
    if (seenIdsRef.current === null) {
      // First poll only — seed the seen-set so existing unread
      // threads don't all immediately toast.
      seenIdsRef.current = incomingIds;
      return;
    }
    const fresh = summary.latest.filter((t) => !seenIdsRef.current!.has(t.id));
    if (fresh.length === 0) {
      seenIdsRef.current = incomingIds;
      return;
    }
    // Honor the per-browser opt-in flag at fire time. Reading from
    // localStorage on each tick (vs. mounting once) means the toggle
    // takes effect without a refresh.
    const enabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem(MAIL_NOTIFICATIONS_KEY) === "true";
    if (enabled) {
      for (const thread of fresh) renderNewMailToast(thread);
    }
    seenIdsRef.current = incomingIds;
  }, []);

  const refreshUnread = useCallback(async () => {
    const summary = await fetchSummary();
    if (summary) apply(summary);
  }, [fetchSummary, apply]);

  useEffect(() => {
    // Kick off the first poll immediately so the seen-set seeds and
    // the badge reconciles with the actual server state (the SSR
    // count can drift if the user opened the tab a while ago).
    void refreshUnread();
    const id = window.setInterval(() => {
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshUnread]);

  return (
    <MailContext.Provider value={{ unreadCount, latestThreads, refreshUnread }}>
      {children}
    </MailContext.Provider>
  );
}

export function useMailContext(): MailContextValue {
  const ctx = useContext(MailContext);
  if (!ctx) {
    // Defensive fallback for surfaces rendered outside the provider
    // (e.g. the unauthenticated /sign-in page where AppShell skips
    // the wrapper). Returning a static zero keeps badge / title
    // rendering as "no unread" instead of crashing.
    return {
      unreadCount: 0,
      latestThreads: [],
      refreshUnread: async () => {},
    };
  }
  return ctx;
}

export const MAIL_NOTIFICATIONS_PREF_KEY = MAIL_NOTIFICATIONS_KEY;
