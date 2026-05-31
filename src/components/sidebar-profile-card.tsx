"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { ChevronRight, Copy, Crown, ExternalLink, Globe, LogOut, Mail, Phone } from "lucide-react";
import { toast } from "sonner";

type Contact = {
  email: string;
  phone: string;
  linkedin: string;
  accessLabel: string;
};

// Per-user contact details + access badge, keyed by signed-in email.
// Internal two-person app, so a small map mirrors the team list already
// hardcoded in the mail composer and placement flows. Andrew is the
// default identity; an unmatched email falls back to it.
const DEFAULT_CONTACT: Contact = {
  email: "andrew@breakpointtalent.com",
  phone: "216-340-9511",
  linkedin: "https://www.linkedin.com/in/andrewkraig/",
  accessLabel: "Ace Creator",
};

const CONTACTS: Record<string, Contact> = {
  "andrew@breakpointtalent.com": DEFAULT_CONTACT,
  "austin@breakpointtalent.com": {
    email: "austin@breakpointtalent.com",
    phone: "(614) 582-4970",
    linkedin: "https://www.linkedin.com/in/austinbarnard/",
    accessLabel: "Ace Founder",
  },
};

export function SidebarProfileCard() {
  const { data: session } = useSession();
  const name = session?.user?.name ?? "Andrew Kraig";
  const imageUrl = session?.user?.image ?? null;
  // Resolve the signed-in user's contact details + badge. Both users
  // share the ADMIN role, so we key off email; unknown emails fall back
  // to the default identity.
  const profile =
    CONTACTS[(session?.user?.email ?? "").toLowerCase()] ?? DEFAULT_CONTACT;

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
      {/* One compact card: avatar / name / phone / chevron on top, a
          content-width status pill below. The card lives INSIDE the sidebar,
          so its chrome tracks the sidebar token family - bg-court-sidebar-card
          (a raised panel that resolves to the sidebar surface on every Court
          Mode), court-sidebar-border, and sidebar foreground text. That keeps
          the card readable and blended on all 8 themes instead of rendering a
          white content-surface card on the green / dark sidebars. Soft
          court-brand glow on hover lives on this wrapper so the pill sits
          inside the same outline. */}
      <div className="rounded-2xl border border-court-sidebar-border bg-court-sidebar-card p-2.5 shadow-[0_0_0_1px_rgb(255_255_255/0.05),inset_0_1px_0_rgb(255_255_255/0.08),0_10px_30px_-10px_rgb(0_0_0/0.45),0_0_22px_-6px_rgb(255_255_255/0.12)] transition-all duration-150 hover:border-court-brand/40 hover:shadow-[0_0_0_1px_rgb(var(--court-brand)/0.18),inset_0_1px_0_rgb(255_255_255/0.10),0_10px_30px_-8px_rgb(0_0_0/0.5),0_0_26px_-4px_rgb(255_255_255/0.16)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open profile contact card"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50"
      >
        {/* Avatar wrapped in the Ace-logo green treatment: brand border,
            soft court-brand glow, and a translucent court-brand-tint wash
            behind the photo. The 40px ring holds a 36px photo so the brand
            wash + border read as a thin ring around the picture. */}
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-court-brand/35 bg-court-brand-tint shadow-[0_0_0_1px_rgb(var(--court-brand)/0.18),0_0_16px_rgb(var(--court-brand)/0.22)]">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={name}
              width={36}
              height={36}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-court-brand-dark">
              {name?.[0] ?? "?"}
            </span>
          )}
        </span>
        {/* min-w-0 lets this column shrink inside the flex row so the name
            WRAPS to a second line instead of truncating. No truncate / no
            fixed width here on purpose: the full name always shows. */}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight text-court-sidebar-fg">
            {name}
          </div>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Copy phone number ${profile.phone}`}
            onClick={(e) => {
              e.stopPropagation();
              void copy(profile.phone, "phone");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                void copy(profile.phone, "phone");
              }
            }}
            className="mt-0.5 block rounded text-[11px] font-medium text-court-sidebar-fg-muted transition hover:text-court-sidebar-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-court-accent/50"
          >
            {profile.phone}
          </span>
        </div>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 self-center text-court-sidebar-fg-dim"
        />
      </button>
        {/* Slim status pill (~20px tall) under the name/phone row. rounded-full
            is allowed here (status pill, per the button standard). ACE CREATOR
            is always brand green on every Court surface (light + dark) - it
            uses the court-brand tokens, not the per-theme accent (which flipped
            to white on Grass/Night Light). Re-skins per court but stays green.
            No raw hex. */}
        <span className="mt-2 flex w-fit items-center justify-center gap-1.5 rounded-full border border-court-brand/40 bg-court-brand/10 px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.12em] text-court-brand">
          <Crown aria-hidden="true" className="h-3 w-3 shrink-0" />
          {/* -mr absorbs the trailing letter-spacing so the crown + label sit
              optically centered inside the pill instead of pushed left. */}
          <span className="-mr-[0.12em]">{profile.accessLabel}</span>
        </span>
      </div>

      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-2 w-72 overflow-hidden rounded-xl border border-court-border bg-court-surface/90 text-sm backdrop-blur-md shadow-[0_8px_40px_rgba(0,0,0,0.35),0_2px_12px_rgba(0,0,0,0.25)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.55),0_2px_12px_rgba(0,0,0,0.35)]">
          <div className="px-4 pb-2 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              My contact info
            </div>
          </div>
          <ul className="space-y-1 px-2 pb-2">
            <ContactRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Work number"
              value={profile.phone}
              onCopy={() => copy(profile.phone, "phone")}
            />
            <ContactRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email"
              value={profile.email}
              onCopy={() => copy(profile.email, "email")}
            />
            <ContactRow
              icon={<Globe className="h-3.5 w-3.5" />}
              label="LinkedIn"
              value={profile.linkedin.replace(/^https?:\/\//, "")}
              onCopy={() => copy(profile.linkedin, "LinkedIn URL")}
              externalHref={profile.linkedin}
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
