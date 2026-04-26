"use client";

import { useEffect } from "react";
import { useMailContext } from "@/lib/mail-context";

// Mirrors Gmail's tab-title behavior: shows "(N) Ace · BreakPoint Talent"
// when the user has unread inbox threads, plain "Ace · BreakPoint Talent"
// otherwise. Reads the unread count from MailContext so it updates on
// the same 30s polling cadence as the sidebar badge — no second Gmail
// API call.
const BASE_TITLE = "Ace · BreakPoint Talent";

export function MailTabTitleSync() {
  const { unreadCount } = useMailContext();
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unreadCount]);
  return null;
}
