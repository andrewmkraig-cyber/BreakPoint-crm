"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    // Same bg pattern as the sidebar — Hard white, Clay #1e293b, Grass
    // #2d4a2d. All text/border colors route through court-* tokens so
    // they track each mode's palette without per-class dark:/grass:
    // overrides.
    <header className="flex h-16 items-center justify-between gap-4 border-b border-court-border bg-court-surface px-6">
      <div className="hidden text-xs uppercase tracking-[0.18em] text-court-fg-muted md:block">
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <div className="flex-1 md:flex-none md:w-80">
        <TopBarSearch />
      </div>
      <div className="flex items-center gap-3">
        {/* Compose FAB sits to the left of the user-info cluster.
            Was a giant fixed bottom-left button before — moved up
            here so it stops overlapping the BreakPoint footer block
            and so its tooltip + popover have room against any edge. */}
        <ComposeFAB />
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
          className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/10 text-court-fg-muted transition hover:border-court-accent hover:text-court-accent-dark"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
