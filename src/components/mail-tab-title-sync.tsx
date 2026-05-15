"use client";

import { useEffect } from "react";
import { useMailContext } from "@/lib/mail-context";
import { usePhoneContext } from "@/lib/phone-context";

// Tab-title + PWA app-icon badge sync. Combines mail unread + phone
// unread into a single total so the home-screen badge and the browser
// tab counter agree. Reads from MailContext (30s Gmail unread poll)
// and PhoneContext (30s /api/phone/unread-count poll) — no extra
// network traffic introduced here, this is purely a presentation
// mirror of state that's already maintained upstream.
//
// Despite the legacy file name, this owns the combined-total surface
// now (badge + tab title); both providers are mounted ancestors via
// app-shell so the hooks are safe to call here.
const BASE_TITLE = "Ace · BreakPoint Talent";

// Badging API typing. Chrome / Edge / Safari ship `navigator.setAppBadge`
// + `navigator.clearAppBadge` (Web App Badging spec) but lib.dom.d.ts
// doesn't include them yet, so narrow against an explicit shape.
type NavigatorWithBadge = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function MailTabTitleSync() {
  const { unreadCount: mailUnread } = useMailContext();
  const { unreadCount: phoneUnread } = usePhoneContext();
  // One-time registration on mount. macOS won't surface the installed
  // PWA in System Settings → Notifications until the page has
  // exercised the Badging API at least once. Calling setAppBadge(0)
  // up front registers Ace as a badge-capable app without showing a
  // dot for "0 unread", and the dependency-driven effect below takes
  // over from there as soon as a real count arrives.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
    };
    if (typeof nav.setAppBadge === "function") {
      void nav.setAppBadge(0).catch(() => {});
    }
  }, []);
  // Bridge from sw.js: when a push lands, the SW fans out a
  // PUSH_RECEIVED message to every open Ace window. Rebroadcast it as
  // a window event so MailProvider + PhoneProvider can re-fetch
  // immediately instead of waiting for the next 30s poll.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED") {
        window.dispatchEvent(new Event("ace:refresh-unread"));
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, []);
  useEffect(() => {
    const total = (mailUnread ?? 0) + (phoneUnread ?? 0);
    // Diagnostic log so the next time the badge looks wrong we can
    // see in DevTools which source is drifting (mail thread count vs
    // phone thread count) without instrumenting upstream contexts.
    // Cheap — fires only when either count changes.
    console.log(
      "[badge] mail unread:",
      mailUnread,
      "phone unread:",
      phoneUnread,
      "total:",
      total,
    );
    document.title = total > 0 ? `(${total}) ${BASE_TITLE}` : BASE_TITLE;
    // Badging API is best-effort: only fires on Chromium-family PWAs
    // and macOS Safari 16.4+. Other browsers silently no-op. Wrap in
    // a try/catch because the promises can reject if the page isn't
    // visible / installed and we don't want to noise the console.
    const nav = navigator as NavigatorWithBadge;
    if (total > 0 && typeof nav.setAppBadge === "function") {
      void nav.setAppBadge(total).catch(() => {});
    } else if (total === 0 && typeof nav.clearAppBadge === "function") {
      void nav.clearAppBadge().catch(() => {});
    }
  }, [mailUnread, phoneUnread]);
  return null;
}
