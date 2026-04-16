"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Internal Ops &middot; {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-medium text-navy">{user?.name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{user?.email ?? ""}</div>
        </div>
        {user?.image ? (
          <Image
            src={user.image}
            alt={user.name ?? "avatar"}
            width={36}
            height={36}
            className="rounded-full border border-border"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand-dark">
            {user?.name?.[0] ?? "?"}
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/sign-in" })}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-navy-400 transition hover:border-brand hover:text-brand-dark"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
