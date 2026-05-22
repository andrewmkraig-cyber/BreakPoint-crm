"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  renderNewTextToast,
  renderNewCallToast,
  TextNotificationPopup,
  type InboundTextEvent,
  type InboundCallEvent,
} from "@/components/text-notification-toast";
import { MAIL_NOTIFICATIONS_PREF_KEY } from "@/lib/mail-context";
import { playSmsSound } from "@/lib/notification-sound";

// Polls /api/krispcall/recent every 30s and fires in-app text/call
// toasts. Reuses the MAIL_NOTIFICATIONS_PREF_KEY localStorage flag —
// same toggle gates email + text/call popups (Andrew didn't ask for a
// separate switch).
//
// Mounted as a sibling of MailProvider in app-shell so it's a no-op on
// the unauthenticated /sign-in surface.
//
// Duplicate-suppression (the "Ace re-shows the text banner on open" bug):
// the /api/krispcall/recent feed returns the last 5 minutes of inbound
// activity regardless of read state or whether a push already fired, so
// naive id-diffing re-toasts events that the OS already notified. Two
// guards fix it:
//   1. Only toast events whose createdAtIso is AFTER this provider
//      mounted. Anything older arrived via push (or was read elsewhere)
//      while Ace was closed/backgrounded — never re-toast it on open.
//   2. Only toast when the window is focused+visible. That is exactly the
//      case sw.js SUPPRESSES the OS push (its push handler skips the
//      notification when an Ace window is focused && visible), so the
//      in-app toast and the OS push are mutually exclusive — never both
//      for one event.
// Seen ids persist in sessionStorage so a provider remount inside a
// session doesn't reseed and re-toast.

const POLL_INTERVAL_MS = 30_000;
const SEEN_TEXT_KEY = "ace_seen_text_ids_v1";
const SEEN_CALL_KEY = "ace_seen_call_ids_v1";
// Cap the persisted seen-set so a long session can't grow it unbounded.
// Set preserves insertion order, so slice(-CAP) keeps the most recent.
const SEEN_CAP = 300;

type RecentResponse = {
  texts: InboundTextEvent[];
  calls: InboundCallEvent[];
};

function loadSeenIds(key: string): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        return new Set(arr.filter((x): x is string => typeof x === "string"));
      }
    }
  } catch {
    // sessionStorage unavailable / malformed — start clean.
  }
  return new Set();
}

function saveSeenIds(key: string, set: Set<string>): void {
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify(Array.from(set).slice(-SEEN_CAP)),
    );
  } catch {
    // Best-effort; the in-memory set still dedupes for this session.
  }
}

// Mirrors sw.js's push-suppression condition exactly: a window that is
// both focused and visible is the only one that shows the in-app toast,
// because that is the only window for which sw.js withholds the OS push.
function isFocusedVisible(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

export function TextingProvider({ children }: { children: ReactNode }) {
  // Pre-seeded from sessionStorage in the mount effect so a remount
  // doesn't reseed and re-toast. mountIsoRef pins "events before here
  // already reached the user" — set on mount, never reset.
  const seenTextIdsRef = useRef<Set<string>>(new Set());
  const seenCallIdsRef = useRef<Set<string>>(new Set());
  const mountIsoRef = useRef<string>("");
  const inFlightRef = useRef(false);

  const tick = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch("/api/krispcall/recent", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as RecentResponse;
      apply(body);
    } catch {
      // Silent — recurring poll, no point alarming the user.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Seed the mount cutoff + persisted seen-sets BEFORE the first poll so
    // the backlog the recent feed returns is suppressed (older than mount)
    // rather than blasted as toasts.
    mountIsoRef.current = new Date().toISOString();
    seenTextIdsRef.current = loadSeenIds(SEEN_TEXT_KEY);
    seenCallIdsRef.current = loadSeenIds(SEEN_CALL_KEY);
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  function apply(body: RecentResponse) {
    const enabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem(MAIL_NOTIFICATIONS_PREF_KEY) === "true";
    // Toast only when this window is the one sw.js withheld the OS push
    // from (focused + visible). Combined with the after-mount check below,
    // every inbound event produces exactly one notification: an OS push
    // when Ace is closed/backgrounded, or an in-app toast when it's the
    // active window — never both.
    const canToast = enabled && isFocusedVisible();
    const mountIso = mountIsoRef.current;
    const seenTexts = seenTextIdsRef.current;
    const seenCalls = seenCallIdsRef.current;

    let anyToasted = false;

    for (const t of body.texts) {
      if (seenTexts.has(t.id)) continue; // handled on a previous tick
      seenTexts.add(t.id); // mark handled regardless of whether we toast
      // Older than this mount => already delivered via push / read
      // elsewhere. Marked seen above, but never re-toasted on open.
      if (canToast && !!mountIso && t.createdAtIso > mountIso) {
        renderNewTextToast(t);
        anyToasted = true;
      }
    }
    for (const c of body.calls) {
      if (seenCalls.has(c.id)) continue;
      seenCalls.add(c.id);
      if (canToast && !!mountIso && c.createdAtIso > mountIso) {
        renderNewCallToast(c);
        anyToasted = true;
      }
    }

    saveSeenIds(SEEN_TEXT_KEY, seenTexts);
    saveSeenIds(SEEN_CALL_KEY, seenCalls);

    // Ace 28.0: shared SMS/call notification sound. Fires once per tick
    // when at least one event actually toasted so a burst produces one
    // cue instead of a stream. Tied to canToast (focused + opted-in), so
    // silent-mode and backgrounded windows stay quiet.
    if (anyToasted) playSmsSound();
  }

  return (
    <>
      {children}
      {/* Global host for the toast View popup — survives toast dismissal. */}
      <TextNotificationPopup />
    </>
  );
}
