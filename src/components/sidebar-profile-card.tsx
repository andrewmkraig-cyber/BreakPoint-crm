"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { ChevronRight, Copy, Crown, ExternalLink, Globe, LogOut, Mail, Phone } from "lucide-react";
import { toast } from "sonner";

const PROFILE = {
  email: "andrew@breakpointtalent.com",
  phone: "216-340-9511",
  linkedin: "https://www.linkedin.com/in/andrewkraig/",
} as const;

export function SidebarProfileCard() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "Andrew Kraig";
  const imageUrl = session?.user?.image ?? null;

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-court-sidebar-border px-2.5 py-2 text-left transition hover:bg-[var(--court-sidebar-active-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50"
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name}
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-full border border-court-sidebar-border object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-court-accent-tint text-sm font-semibold text-court-accent-dark">
            {name?.[0] ?? "?"}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-court-sidebar-fg">
            {name}
          </div>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Copy phone number ${PROFILE.phone}`}
            onClick={(e) => {
              e.stopPropagation();
              void copy(PROFILE.phone, "phone");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                void copy(PROFILE.phone, "phone");
              }
            }}
            className="mt-0.5 block truncate rounded text-[11px] font-medium text-court-sidebar-fg-muted transition hover:text-court-sidebar-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-court-accent/50"
          >
            {PROFILE.phone}
          </span>
          {/* Slim status pill. Brand green text + faint brand tint bg,
              theme-aware via court-brand tokens (no hardcoded color). */}
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-court-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-court-brand">
            <Crown aria-hidden="true" className="h-3 w-3" />
            Ace Creator
          </span>
        </div>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 self-center text-court-sidebar-fg-dim"
        />
      </button>

      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-2 w-72 overflow-hidden rounded-xl border border-court-border bg-court-surface text-sm shadow-lg">
          <div className="px-4 pb-2 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              My contact info
            </div>
          </div>
          <ul className="space-y-1 px-2 pb-2">
            <ContactRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Work number"
              value={PROFILE.phone}
              onCopy={() => copy(PROFILE.phone, "phone")}
            />
            <ContactRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email"
              value={PROFILE.email}
              onCopy={() => copy(PROFILE.email, "email")}
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
