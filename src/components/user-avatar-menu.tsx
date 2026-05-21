"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

// Far-right topbar account control. Renders the user's Google profile
// photo at the same 40px (h-10 w-10) footprint as the topbar icon
// buttons so it sits flush on the row. Clicking opens a small dropdown
// with the user's name, email, and a Sign Out button (NextAuth signOut).
// If there's no image URL or the photo fails to load, the same circle
// shows the user's initials instead.

// First + last initial from the display name, falling back to the email's
// first character, then "?". Single-word names just use the first letter.
function initialsFrom(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = (name ?? "").trim();
  if (source) {
    const parts = source.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
    const combined = (first + last).toUpperCase();
    return combined || first.toUpperCase() || "?";
  }
  const e = (email ?? "").trim();
  return e ? e[0].toUpperCase() : "?";
}

export function UserAvatarMenu() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? null;
  const email = session?.user?.email ?? null;
  const imageUrl = session?.user?.image ?? null;

  const [open, setOpen] = useState(false);
  // Flips when the <Image> onError fires so a dead photo URL falls back
  // to initials instead of a broken-image glyph.
  const [imgFailed, setImgFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape. Mirrors the sidebar profile card.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const node = wrapperRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = initialsFrom(name, email);
  const showImage = Boolean(imageUrl) && !imgFailed;
  const displayName = name ?? email ?? "Signed in";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="group inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-court-border bg-court-surface shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:border-court-brand focus:outline-none focus-visible:ring-[3px] focus-visible:ring-court-brand/40"
      >
        {showImage && imageUrl ? (
          <Image
            src={imageUrl}
            alt={displayName}
            width={40}
            height={40}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-court-brand-tint text-sm font-semibold text-court-brand-dark">
            {initials}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-court-border bg-court-surface text-sm shadow-lg"
        >
          <div className="px-4 pb-3 pt-3">
            <div className="truncate text-[13px] font-semibold text-court-fg">
              {displayName}
            </div>
            {email && (
              <div
                className="mt-0.5 truncate text-[11px] text-court-fg-muted"
                title={email}
              >
                {email}
              </div>
            )}
          </div>
          <div className="border-t border-court-border px-2 py-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: "/sign-in" })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
