"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  renderNewTextToast,
  renderNewCallToast,
  type InboundTextEvent,
  type InboundCallEvent,
} from "@/components/text-notification-toast";
import { MAIL_NOTIFICATIONS_PREF_KEY } from "@/lib/mail-context";

// Polls /api/krispcall/recent every 30s and fires text/call toasts
// for events that weren't present on the previous tick. Reuses the
// MAIL_NOTIFICATIONS_PREF_KEY localStorage flag — same toggle gates
// both email + text/call popups (Andrew didn't ask for a separate
// switch). The first poll seeds the seen-id set so the user doesn't
// get blasted with toasts for everything that arrived while Ace was
// closed.
//
// Mounted as a sibling of MailProvider in app-shell so it's a
// no-op on the unauthenticated /sign-in surface.

const POLL_INTERVAL_MS = 30_000;

type RecentResponse = {
  texts: InboundTextEvent[];
  calls: InboundCallEvent[];
};

export function TextingProvider({ children }: { children: ReactNode }) {
  const seenTextIdsRef = useRef<Set<string> | null>(null);
  const seenCallIdsRef = useRef<Set<string> | null>(null);
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

    const incomingTexts = new Set(body.texts.map((t) => t.id));
    if (seenTextIdsRef.current === null) {
      seenTextIdsRef.current = incomingTexts;
    } else {
      const fresh = body.texts.filter((t) => !seenTextIdsRef.current!.has(t.id));
      if (enabled) for (const t of fresh) renderNewTextToast(t);
      seenTextIdsRef.current = incomingTexts;
    }

    const incomingCalls = new Set(body.calls.map((c) => c.id));
    if (seenCallIdsRef.current === null) {
      seenCallIdsRef.current = incomingCalls;
    } else {
      const fresh = body.calls.filter((c) => !seenCallIdsRef.current!.has(c.id));
      if (enabled) for (const c of fresh) renderNewCallToast(c);
      seenCallIdsRef.current = incomingCalls;
    }
  }

  return <>{children}</>;
}
