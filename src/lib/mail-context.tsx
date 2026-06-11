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
// together every 15s without a hard refresh. The 15s cadence is a
// fallback only: Gmail push (webhook → web push → sw.js →
// PUSH_RECEIVED → ace:refresh-unread) drives the same refresh within
// seconds of an inbound, so this interval mostly catches the case
// where push didn't reach the client (no notification permission,
// expired push subscription, etc.).
//
// The provider seeds itself from the server-rendered count passed in
// at app-shell mount, then overwrites that with each poll's payload.
// "New thread" detection is by id-set diff, not count delta — that
// way a thread arriving + another being read in the same window still
// surfaces a toast for the new one.

const POLL_INTERVAL_MS = 15_000;
const MAIL_NOTIFICATIONS_KEY = "ace_mail_notifications";

export type UnreadInboxThread = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  timestampIso: string | null;
};

// count is `number | null`: null = UNKNOWN (unresolved session / failed
// Gmail lookup), distinct from 0 (proven empty inbox). The provider keeps
// its last-known count on null so a transient blip can't zero the badge.
type Summary = { count: number | null; latest: UnreadInboxThread[] };

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
    // UNKNOWN count (count === null): the server could not prove the
    // unread total this tick. Keep the last-known count + threads + seen
    // set untouched rather than zeroing the badge. `latest` is empty in
    // this case, so bailing before the seed below also avoids wiping the
    // seen-id set (which would re-toast the whole inbox on recovery).
    if (typeof summary.count !== "number") return;
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
// Phone (texts + calls) in-app popup opt-in. Separate from the mail key
// so Settings can silence phone popups without touching email. The Quo
// webhook gates the matching OS push server-side via notifPrefs.
export const PHONE_NOTIFICATIONS_PREF_KEY = "ace_phone_notifications";

// Fired on the window whenever a notification-channel toggle changes in
// THIS tab. The native `storage` event only reaches other tabs, so the
// Settings switch dispatches this too and same-tab badge/title surfaces
// update live without a refresh.
export const NOTIF_PREFS_CHANGED_EVENT = "ace:notif-prefs-changed";

// Reactive read of an in-app notification channel toggle (mail/phone).
// Mirrors how texting-context gates toasts: the channel is ON unless its
// localStorage flag is explicitly "false" (absent => default ON, matching
// the server notifPrefs default). Badge + tab-title surfaces gate their
// unread count through this, so turning a channel off clears its badge
// too, not just its popups. Stays true on the server / first paint (the
// unread counts start at 0 there anyway), then reconciles post-mount and
// on every same-tab (NOTIF_PREFS_CHANGED_EVENT) or cross-tab (storage)
// change.
export function useNotifChannelEnabled(key: string): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const read = () =>
      setEnabled(window.localStorage.getItem(key) !== "false");
    read();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === key) read();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(NOTIF_PREFS_CHANGED_EVENT, read);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(NOTIF_PREFS_CHANGED_EVENT, read);
    };
  }, [key]);
  return enabled;
}
