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
import { playMailSound } from "@/lib/notification-sound";

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
  // Optimistic clear for a single thread. Called when the user opens a
  // thread inside the Mail tab so the sidebar badge + topbar title
  // drop the count immediately instead of waiting on the next 30s
  // poll. Idempotent — calling it twice for the same id is a no-op.
  markThreadRead: (threadId: string) => void;
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
      for (const thread of fresh) {
        renderNewMailToast(thread);
        // Web push for every other device the recruiter has logged in
        // on. Relayed through /api/push/fire because sendPushToUser is
        // server-only. Best-effort: fire-and-forget; a 4xx/5xx never
        // surfaces to the toast UI.
        void fetch("/api/push/fire", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: thread.fromName || thread.fromEmail || "New mail",
            body: thread.subject || "(no subject)",
            url: `/mail?thread=${encodeURIComponent(thread.id)}`,
            tag: `mail-${thread.id}`,
          }),
        }).catch(() => {});
      }
      // Ace 28.0: play the recruiter's chosen mail notification sound
      // when fresh threads land. Fires once per poll batch (not per
      // thread) so a flurry of new mail produces a single audible cue
      // instead of a stream of overlapping tones.
      playMailSound();
    }
    seenIdsRef.current = incomingIds;
  }, []);

  const refreshUnread = useCallback(async () => {
    const summary = await fetchSummary();
    if (summary) apply(summary);
  }, [fetchSummary, apply]);

  // Optimistic mark-read used by the Mail Tab when the recruiter opens
  // an unread thread. Decrements the badge + title count immediately
  // and prunes the row from latestThreads. The next poll reconciles
  // with the real Gmail state — but until then the UI feels instant.
  const markThreadRead = useCallback((threadId: string) => {
    setLatestThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);
      // Only decrement if we were actually tracking the thread as
      // unread; otherwise the count stays put and the next poll will
      // correct any drift. Floored at 0 so a stale double-call can't
      // produce a negative badge.
      if (next.length !== prev.length) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      return next;
    });
    if (seenIdsRef.current) seenIdsRef.current.delete(threadId);
  }, []);

  useEffect(() => {
    // Kick off the first poll immediately so the seen-set seeds and
    // the badge reconciles with the actual server state (the SSR
    // count can drift if the user opened the tab a while ago).
    void refreshUnread();
    const id = window.setInterval(() => {
      void refreshUnread();
    }, POLL_INTERVAL_MS);
    // Push-arrival fast path: when sw.js receives a push, MailTabTitleSync
    // dispatches ace:refresh-unread so the badge + toast fire on the
    // same tick instead of lagging up to 30s behind the OS notification.
    function onRefresh() {
      void refreshUnread();
    }
    window.addEventListener("ace:refresh-unread", onRefresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("ace:refresh-unread", onRefresh);
    };
  }, [refreshUnread]);

  return (
    <MailContext.Provider value={{ unreadCount, latestThreads, refreshUnread, markThreadRead }}>
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
      markThreadRead: () => {},
    };
  }
  return ctx;
}

export const MAIL_NOTIFICATIONS_PREF_KEY = MAIL_NOTIFICATIONS_KEY;
