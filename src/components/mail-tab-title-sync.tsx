"use client";

import { useEffect } from "react";

// Mirrors Gmail's tab-title behavior: shows "(N) Ace · BreakPoint Talent"
// when the user has unread inbox threads, plain "Ace · BreakPoint Talent"
// otherwise. Reuses the count already fetched server-side in the root
// layout for the sidebar badge — no second Gmail API call.
//
// On every navigation the root layout re-runs server-side and supplies
// a fresh count via prop, which retriggers this useEffect.
const BASE_TITLE = "Ace · BreakPoint Talent";

export function MailTabTitleSync({ count }: { count: number }) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, [count]);
  return null;
}
