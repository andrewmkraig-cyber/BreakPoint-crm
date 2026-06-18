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
import { isNewMailPollCandidate } from "@/lib/gmail-notification-candidates";
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

  // Keep the last-message timestamp for every thread observed during this app
  // session. Gmail can resurface an old unread thread as a reply nudge, causing
  // it to rotate out of and later back into the five-thread poll window. A
  // retained timestamp lets us distinguish that reshuffle from a real reply in
  // the same thread, whose last-message timestamp advances.
  const seenThreadTimestampsRef = useRef<Map<string, string | null> | null>(null);
  const previousPollAtRef = useRef<number | null>(null);
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
    const observedAtMs = Date.now();
    if (seenThreadTimestampsRef.current === null) {
      // First poll only — seed the timestamp map so existing unread
      // threads don't all immediately toast.
      seenThreadTimestampsRef.current = new Map(
        summary.latest.map((thread) => [thread.id, thread.timestampIso]),
      );
      previousPollAtRef.current = observedAtMs;
      return;
    }
    const seenTimestamps = seenThreadTimestampsRef.current;
    const previousPollAtMs = previousPollAtRef.current ?? observedAtMs;
    const fresh = summary.latest.filter((thread) =>
      isNewMailPollCandidate({
        timestampIso: thread.timestampIso,
        previousTimestampIso: seenTimestamps.get(thread.id),
        previousPollAtMs,
      }),
    );
    for (const thread of summary.latest) {
      seenTimestamps.set(thread.id, thread.timestampIso);
    }
    previousPollAtRef.current = observedAtMs;
    if (fresh.length === 0) return;
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
    // Keep the observed timestamp. If the thread is later marked unread or
    // resurfaced by Gmail, it should stay quiet; a genuine reply still has a
    // newer last-message timestamp and will notify normally.
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
