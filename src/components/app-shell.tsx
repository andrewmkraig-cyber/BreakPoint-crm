"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { MailTabTitleSync } from "@/components/mail-tab-title-sync";
import { MailProvider } from "@/lib/mail-context";
import { PhoneProvider } from "@/lib/phone-context";
import { TextingProvider } from "@/lib/texting-context";

const UNAUTH_PATHS = ["/sign-in"];

export function AppShell({
  children,
  unreadMailCount = 0,
}: {
  children: ReactNode;
  unreadMailCount?: number;
}) {
  const pathname = usePathname();
  const isUnauth = UNAUTH_PATHS.some((p) => pathname?.startsWith(p));

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
            <Sidebar />
            <div className="flex flex-1 flex-col">
              <TopBar />
              <main className="flex-1 p-6 md:p-8">{children}</main>
            </div>
          </div>
        </TextingProvider>
      </PhoneProvider>
    </MailProvider>
  );
}
