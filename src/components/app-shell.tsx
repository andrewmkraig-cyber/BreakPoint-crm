"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { MailTabTitleSync } from "@/components/mail-tab-title-sync";
import { MailProvider } from "@/lib/mail-context";
import { PhoneProvider } from "@/lib/phone-context";
import { TextingProvider } from "@/lib/texting-context";

const UNAUTH_PATHS = ["/sign-in"];

// Sidebar width bounds. Default 240px matches the legacy `w-60` class
// the sidebar shipped with for years. Min keeps icons + at least the
// shortest nav label visible; max stops the sidebar from eating the
// content column on smaller laptops.
const SIDEBAR_WIDTH_DEFAULT = 240;
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 420;
const SIDEBAR_WIDTH_KEY = "ace-sidebar-width";

export function AppShell({
  children,
  unreadMailCount = 0,
}: {
  children: ReactNode;
  unreadMailCount?: number;
}) {
  const pathname = usePathname();
  const isUnauth = UNAUTH_PATHS.some((p) => pathname?.startsWith(p));

  // Sidebar width state lives in AppShell so the drag handle can sit
  // adjacent to <Sidebar /> in the same flex row. Persisted to
  // localStorage so the recruiter's chosen width survives navigation.
  // Hydrate-then-persist pattern with isFirstLoad ref avoids the
  // two-effect race that would otherwise clobber the saved value with
  // the initial default on first commit.
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_WIDTH_DEFAULT);
  const isFirstLoad = useRef(true);
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      try {
        const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
        if (raw) {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            setSidebarWidth(Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, n)));
          }
        }
      } catch {
        // Corrupt / unreadable storage — keep default.
      }
      return;
    }
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Quota / private mode — non-fatal.
    }
  }, [sidebarWidth]);

  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const start = dragStartRef.current;
      if (!start) return;
      const next = Math.max(
        SIDEBAR_WIDTH_MIN,
        Math.min(SIDEBAR_WIDTH_MAX, start.w + (e.clientX - start.x)),
      );
      setSidebarWidth(next);
    }
    function onUp() {
      setDragging(false);
      dragStartRef.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);
  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, w: sidebarWidth };
      setDragging(true);
    },
    [sidebarWidth],
  );

  // Wrapper background tracks the active court mode via `court-surface-subtle`
  // (= current bg-muted #F4F6F8 in Hard, slate-800 in Clay, mid-green in
  // Grass). Previously this was hardcoded `bg-muted` which painted light gray
  // over every mode — Clay / Grass body color would show only at the
  // browser's scroll-overflow edges, making the "full page background dark"
  // switch feel broken.
  if (isUnauth) {
    return <main className="min-h-screen bg-court-surface-subtle">{children}</main>;
  }

  // MailProvider polls /api/mail/unread every 30s; the SSR count seeds
  // its initial value so the badge has a number to show before the
  // first poll lands. Sidebar + tab title both read from the context
  // so they stay in lockstep without any prop drilling.
  return (
    <MailProvider initialUnreadCount={unreadMailCount}>
      <PhoneProvider>
        <TextingProvider>
          <div className="flex min-h-screen bg-court-surface-subtle">
            <MailTabTitleSync />
            <Sidebar width={sidebarWidth} />
            {/* Resize handle sits between the sticky sidebar and the
                main content column. position: sticky + h-screen keeps
                the hit-target visible at every scroll position so the
                user can grab it from anywhere on the page. Hidden at
                <md where the sidebar itself is hidden. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onMouseDown={onHandleMouseDown}
              className={
                "sticky top-0 hidden h-screen w-1.5 shrink-0 cursor-col-resize self-start md:block " +
                (dragging ? "bg-brand/40" : "bg-transparent hover:bg-brand/20")
              }
            />
            {/* min-w-0 on the flex-1 column + main lets nested
                wide content (e.g. /jobs table with min-w-[1080px])
                trigger their own overflow-x-auto wrappers instead of
                pushing the entire page wider than the viewport. Without
                min-w-0, flex-1's default min-content sizing follows
                the widest descendant and shoves header action buttons
                (Post New Job, Search, etc.) off the right edge. */}
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              {/* Left padding intentionally tighter than the other
                  sides — the resize handle already provides visual
                  separation from the sidebar, so a full p-8 gutter
                  on the left wasted ~16px of horizontal real estate
                  before the page content even started. Right / top /
                  bottom keep their original p-6/md:p-8 generosity. */}
              <main className="min-w-0 flex-1 p-6 pl-3 md:p-8 md:pl-4">{children}</main>
            </div>
          </div>
        </TextingProvider>
      </PhoneProvider>
    </MailProvider>
  );
}
