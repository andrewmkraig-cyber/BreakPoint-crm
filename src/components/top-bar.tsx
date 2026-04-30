"use client";

import { useSession } from "next-auth/react";
import { TopBarSearch } from "@/components/top-bar-search";
import { ComposeFAB } from "@/components/mail/compose-fab";
import { TopBarProfileCard } from "@/components/top-bar-profile-card";

export function TopBar() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    // Same `bg-court-surface` token the sidebar uses — they read as one
    // continuous bar across the top of the page. No horizontal
    // dividing border so the brand-mark wrapper and the topbar sit
    // flush against each other; all four court modes resolve through
    // the shared token.
    //
    // sticky top-0 + z-30 pins the bar to the viewport top while the
    // page content scrolls underneath, mirroring the sidebar's
    // sticky-h-screen behavior. Page-level modals and floating panels
    // (z-50, z-[100], z-[1000]+) still render above.
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between gap-4 bg-court-surface px-6">
      <div className="hidden text-xs uppercase tracking-[0.18em] text-court-fg-muted md:block">
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <div className="flex-1 md:flex-none md:w-80">
        <TopBarSearch />
      </div>
      <div className="flex items-center gap-3">
        {/* Compose FAB sits to the left of the avatar. The standalone
            name + email block + sign-out button used to live here too;
            both folded into the avatar's contact-card dropdown so the
            top bar stays compact and the recruiter has one-click
            access to the email/phone/LinkedIn copy actions he uses
            most often when hand-writing candidate intros. */}
        <ComposeFAB />
        <TopBarProfileCard
          name={user?.name ?? null}
          imageUrl={user?.image ?? null}
        />
      </div>
    </header>
  );
}
