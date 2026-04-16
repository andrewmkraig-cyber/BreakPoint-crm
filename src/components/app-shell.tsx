"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";

const UNAUTH_PATHS = ["/sign-in"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isUnauth = UNAUTH_PATHS.some((p) => pathname?.startsWith(p));

  if (isUnauth) {
    return <main className="min-h-screen bg-muted">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-muted">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
