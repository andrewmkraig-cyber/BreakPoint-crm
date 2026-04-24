"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { TopBarSearch } from "@/components/top-bar-search";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    // Same bg pattern as the sidebar — Hard white, Clay #1e293b, Grass
    // #2d4a2d. All text/border colors route through court-* tokens so
    // they track each mode's palette without per-class dark:/grass:
    // overrides.
    <header className="flex h-16 items-center justify-between gap-4 border-b border-court-border bg-white dark:bg-[#1e293b] grass:bg-[#2d4a2d] px-6">
      <div className="hidden text-xs uppercase tracking-[0.18em] text-court-fg-muted md:block">
        Internal Ops &middot; {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <div className="flex-1 md:flex-none md:w-80">
        <TopBarSearch />
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-medium text-court-fg">{user?.name ?? "—"}</div>
          <div className="text-xs text-court-fg-muted">{user?.email ?? ""}</div>
        </div>
        {user?.image ? (
          <Image
            src={user.image}
            alt={user.name ?? "avatar"}
            width={36}
            height={36}
            className="rounded-full border border-court-border"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-court-accent-tint text-sm font-semibold text-court-accent-dark">
            {user?.name?.[0] ?? "?"}
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/sign-in" })}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-court-border text-court-fg-muted transition hover:border-court-accent hover:text-court-accent-dark"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
