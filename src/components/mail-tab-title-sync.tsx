"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useMailContext } from "@/lib/mail-context";
import { usePhoneContext } from "@/lib/phone-context";

// Tab-title + PWA app-icon badge sync. Combines mail unread + phone
// unread into a single total so the home-screen badge and the browser
// tab counter agree. Reads from MailContext (15s Gmail unread poll +
// instant push-driven refresh) and PhoneContext (30s
// /api/phone/unread-count poll + instant push refresh) — no extra
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

const BADGE_REGISTERED_KEY = "ace_badge_registered_v1";

export function MailTabTitleSync() {
  const { unreadCount: mailUnread } = useMailContext();
  const { unreadCount: phoneUnread } = usePhoneContext();
  // Route changes restamp document.title from the new page's Next
  // metadata, wiping the count we set here. Tracking pathname as a dep
  // re-applies the title after every navigation so "(5)" survives a tab
  // click instead of vanishing until the next poll or hard refresh.
  const pathname = usePathname();
  // One-time registration on mount. macOS won't surface the installed
  // PWA in System Settings → Notifications until the page has
  // exercised the Badging API at least once — but firing setAppBadge(0)
  // on EVERY mount stomps on any badge the service worker set while
  // Ace was closed (e.g. a push that landed during background, then
  // the user opens Ace → badge briefly drops to 0 before the
  // dep-driven effect below restores the real total).
  //
  // Gate behind a localStorage flag so the registration call fires
  // exactly once per install. After that the dep-driven effect is the
  // sole writer of the badge from the client side.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(BADGE_REGISTERED_KEY) === "1") return;
    } catch {
      // localStorage unavailable (private mode etc.) — fall through and
      // attempt the register; worst case it runs more than once.
    }
    const nav = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
    };
    if (typeof nav.setAppBadge !== "function") return;
    void nav
      .setAppBadge(0)
      .then(() => {
        try {
          window.localStorage.setItem(BADGE_REGISTERED_KEY, "1");
        } catch {
          // Persisting is best-effort; the API was still exercised.
        }
      })
      .catch(() => {});
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
  }, [mailUnread, phoneUnread, pathname]);
  return null;
}
