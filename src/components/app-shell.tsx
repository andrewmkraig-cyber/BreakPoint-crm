"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";

const UNAUTH_PATHS = ["/sign-in"];

export function AppShell({ children }: { children: ReactNode }) {
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

  return (
    <div className="flex min-h-screen bg-court-surface-subtle">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
