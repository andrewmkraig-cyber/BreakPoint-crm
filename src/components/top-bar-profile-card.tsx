"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Copy, ExternalLink, Globe, LogOut, Mail, Phone } from "lucide-react";
import { toast } from "sonner";

// Replaces the old name + email block + standalone sign-out button in
// the top bar. Click the avatar → small dropdown surfaces the contact
// info Andrew copies into candidate-facing emails most often (work
// email, work number, LinkedIn URL). Each row has a copy-icon button
// for one-click copy. Click outside or press Escape to dismiss.
//
// This is intentionally small and personal (one user's contact card)
// rather than a generic "user menu." Sign Out lives at the bottom so
// the previous dedicated logout button can go away too.
const PROFILE = {
  email: "andrew@breakpointtalent.com",
  phone: "216-340-9511",
  linkedin: "https://www.linkedin.com/in/andrewkraig/",
} as const;

export function TopBarProfileCard({
  name,
  imageUrl,
}: {
  name: string | null;
  imageUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const node = wrapperRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false);
      }
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

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Copied ${label}`);
    } catch {
      toast.error(`Couldn't copy ${label}`);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open profile contact card"
        className="block rounded-full"
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name ?? "avatar"}
            width={40}
            height={40}
            className="rounded-full border border-court-border"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-court-accent-tint text-sm font-semibold text-court-accent-dark">
            {name?.[0] ?? "?"}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-court-border bg-court-surface text-sm shadow-lg">
          <div className="px-4 pb-2 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              My contact info
            </div>
          </div>
          <ul className="space-y-1 px-2 pb-2">
            <ContactRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email"
              value={PROFILE.email}
              onCopy={() => copy(PROFILE.email, "email")}
            />
            <ContactRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Work number"
              value={PROFILE.phone}
              onCopy={() => copy(PROFILE.phone, "phone")}
            />
            <ContactRow
              icon={<Globe className="h-3.5 w-3.5" />}
              label="LinkedIn"
              value={PROFILE.linkedin.replace(/^https?:\/\//, "")}
              onCopy={() => copy(PROFILE.linkedin, "LinkedIn URL")}
              externalHref={PROFILE.linkedin}
            />
          </ul>
          <div className="border-t border-court-border px-2 py-1.5">
            <button
              type="button"
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

function ContactRow({
  icon,
  label,
  value,
  onCopy,
  externalHref,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onCopy: () => void;
  externalHref?: string;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-court-surface-subtle">
      <span className="text-court-fg-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-court-fg-muted">
          {label}
        </div>
        <div className="truncate text-xs text-court-fg" title={value}>
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        className="rounded p-1 text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {externalHref && (
        <a
          href={externalHref}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Open in new tab"
          title="Open in new tab"
          className="rounded p-1 text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </li>
  );
}
