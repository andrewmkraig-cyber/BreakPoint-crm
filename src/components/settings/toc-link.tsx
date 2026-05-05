"use client";

import type { MouseEvent, ReactNode } from "react";
import { SETTINGS_EXPAND_EVENT } from "./collapsible-section";

// Settings sticky-TOC link. Wraps a normal anchor so the standard
// browser scroll-to-anchor still works, then dispatches a
// SETTINGS_EXPAND_EVENT with the target id so the matching
// CollapsibleSection auto-expands even when it was previously
// collapsed. Fires on every click so re-clicking the same link still
// re-expands a section the recruiter just collapsed.
export function SettingsTocLink({
  targetId,
  children,
  className,
}: {
  targetId: string;
  children: ReactNode;
  className?: string;
}) {
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // Allow modifier-clicks (cmd/ctrl/shift) to behave like normal so
    // the recruiter can open a section in a new tab if they want.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent<string>(SETTINGS_EXPAND_EVENT, { detail: targetId }),
    );
    // If the URL hash already matched this section, the browser would
    // skip scrolling. Force the scroll to land on the (now-expanded)
    // section in that edge case.
    if (window.location.hash.replace(/^#/, "") === targetId) {
      e.preventDefault();
      const el = document.getElementById(targetId);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  return (
    <a href={`#${targetId}`} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
