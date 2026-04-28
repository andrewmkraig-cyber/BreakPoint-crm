"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Phone, PhoneCall, Plus, Search, Send } from "lucide-react";
import { useComposerManager } from "@/lib/composer-manager";
import {
  usePhonePanels,
  type PhoneContact,
} from "@/lib/phone-panels-context";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Floating action button mounted at the application shell so it's
// reachable from every signed-in surface. Two modes:
//
// 1. /phone routes — renders a Phone icon and opens a "Start
//    conversation" popover anchored above the FAB. Inside the popover
//    the user picks a recent contact (or types one) and chooses Send
//    text vs. Make call. Selection is forwarded to PhonePanelsContext
//    which the PhoneView reads to render the actual New-Text /
//    Call panels.
//
// 2. Everywhere else — keeps the original behavior: Plus icon,
//    opens a non-blocking mail composer via the ComposerManager.
//    On /candidates/[id] the composer's To field is prefilled from
//    /api/mail/candidate-context.
//
// Templates + the signed-in user's name come from /api/mail/compose-init
// (cached at module scope).

type InitPayload = {
  templates: ActiveTemplateSummary[];
  user: { firstName: string; fullName: string };
};

let cachedInit: Promise<InitPayload> | null = null;

function fetchInit(): Promise<InitPayload> {
  if (cachedInit) return cachedInit;
  cachedInit = (async () => {
    const res = await fetch("/api/mail/compose-init");
    if (!res.ok) {
      cachedInit = null;
      throw new Error(`compose-init failed (${res.status})`);
    }
    return (await res.json()) as InitPayload;
  })();
  return cachedInit;
}

type RecentThread = {
  id: string;
  candidateId: string;
  contactName: string;
  phoneNumber: string;
  kind: "candidate";
};

export function ComposeFAB() {
  const pathname = usePathname();
  const isPhone = pathname?.startsWith("/phone") ?? false;

  // Phone-mode UI state. Popover is local to the FAB; selected
  // contact propagates to the PhoneView via PhonePanelsContext.
  const phonePanels = usePhonePanels();
  const [phonePopoverOpen, setPhonePopoverOpen] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [recentThreads, setRecentThreads] = useState<RecentThread[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [pendingContact, setPendingContact] = useState<PhoneContact | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const phoneSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Mail-mode state (unchanged from prior implementation).
  const composer = useComposerManager();
  const [contextEmail, setContextEmail] = useState("");
  const [contextRef, setContextRef] = useState("");
  const [opening, setOpening] = useState(false);

  // Mail-only: resolve a candidate email when on /candidates/[id].
  useEffect(() => {
    if (isPhone) return; // mail-mode-only
    if (!pathname) {
      setContextEmail("");
      setContextRef("");
      return;
    }
    const m = pathname.match(/^\/candidates\/([^/]+)/);
    if (!m) {
      setContextEmail("");
      setContextRef("");
      return;
    }
    const ref = decodeURIComponent(m[1]);
    setContextRef(ref);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/mail/candidate-context/${encodeURIComponent(ref)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as
          | { candidate?: { email?: string } }
          | null;
        if (!cancelled && body?.candidate?.email) {
          setContextEmail(body.candidate.email);
        }
      } catch {
        // Silent: FAB still works without prefill.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, isPhone]);

  // Phone-only: load the last 5 threads for the popover when it opens.
  useEffect(() => {
    if (!isPhone || !phonePopoverOpen) return;
    let cancelled = false;
    setRecentLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/phone/threads?limit=5", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as
          | { threads?: RecentThread[] }
          | null;
        if (!cancelled && body?.threads) {
          setRecentThreads(body.threads);
        }
      } catch {
        // Silent
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPhone, phonePopoverOpen]);

  // Phone-only: focus the search input when the popover opens.
  useEffect(() => {
    if (phonePopoverOpen) {
      const t = setTimeout(() => phoneSearchInputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [phonePopoverOpen]);

  // Phone-only: Escape + outside-click dismiss for the popover.
  useEffect(() => {
    if (!phonePopoverOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPhonePopoverOpen(false);
    }
    function onClick(e: MouseEvent) {
      const node = popoverRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setPhonePopoverOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [phonePopoverOpen]);

  // Phone-only: filter recent threads against the search term.
  const filteredRecents = useMemo(() => {
    const q = phoneSearch.trim().toLowerCase();
    if (!q) return recentThreads;
    return recentThreads.filter(
      (t) =>
        t.contactName.toLowerCase().includes(q) ||
        t.phoneNumber.includes(q),
    );
  }, [phoneSearch, recentThreads]);

  function pickRecent(t: RecentThread) {
    setPendingContact({
      candidateId: t.candidateId,
      name: t.contactName,
      phoneNumber: t.phoneNumber,
      tag: "Candidate",
    });
  }

  function commitText() {
    phonePanels.openText(pendingContact);
    setPhonePopoverOpen(false);
    setPendingContact(null);
    setPhoneSearch("");
  }

  function commitCall() {
    if (!pendingContact) return;
    phonePanels.openCall(pendingContact);
    setPhonePopoverOpen(false);
    setPendingContact(null);
    setPhoneSearch("");
  }

  async function onMailClick() {
    if (opening) return;
    setOpening(true);
    try {
      const init = await fetchInit();
      composer.open({
        defaultTo: contextEmail,
        defaultSubject: "",
        templates: init.templates,
        candidateRef: contextRef || undefined,
        nonBlocking: true,
        mergeContext: {
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
      });
    } finally {
      setOpening(false);
    }
  }

  // -------- Phone-mode render --------
  if (isPhone) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPhonePopoverOpen((v) => !v)}
          aria-label="Start call or text"
          aria-expanded={phonePopoverOpen}
          title="New call or text"
          className="group fixed left-6 bottom-6 z-[1000] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#438631] active:bg-[#39762A] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,154,58,0.35)]"
          style={{
            background: "#4F9A3A",
            transform: phonePopoverOpen ? "rotate(15deg)" : undefined,
            transitionDuration: "160ms",
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 bottom-full mb-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            New call or text
          </span>
          <Phone className="h-7 w-7" strokeWidth={2.5} />
        </button>
        {phonePopoverOpen && (
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Start conversation"
            className="fixed left-6 bottom-24 z-[1001] w-80 rounded-xl border border-court-border bg-court-surface p-3 shadow-2xl"
          >
            <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Start conversation
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
              <input
                ref={phoneSearchInputRef}
                type="search"
                value={phoneSearch}
                onChange={(e) => setPhoneSearch(e.target.value)}
                placeholder="Search candidate, client, or phone number..."
                aria-label="Search contacts"
                className="h-9 w-full rounded-md border border-court-border bg-court-surface pl-8 pr-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {recentLoading ? (
                <div className="px-2 py-3 text-xs text-court-fg-muted">
                  Loading recents…
                </div>
              ) : filteredRecents.length === 0 ? (
                <div className="px-2 py-3 text-xs text-court-fg-muted">
                  {phoneSearch
                    ? "No matches in recent contacts."
                    : "No recent conversations yet."}
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {filteredRecents.map((t) => {
                    const initials = t.contactName
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((s) => s[0]!.toUpperCase())
                      .join("");
                    const active = pendingContact?.candidateId === t.candidateId;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => pickRecent(t)}
                          className={
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition " +
                            (active
                              ? "bg-[#EAF4E4] text-[#3F7030]"
                              : "text-court-fg hover:bg-court-surface-subtle")
                          }
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-court-surface-subtle text-[10px] font-semibold uppercase text-court-fg-muted">
                            {initials || "?"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {t.contactName || t.phoneNumber || "(unknown)"}
                            </span>
                            <span className="block truncate text-[11px] text-court-fg-muted">
                              {t.phoneNumber}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-sm bg-court-surface-subtle px-1 py-0.5 text-[10px] uppercase tracking-wider text-court-fg-muted">
                            Candidate
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-court-border pt-3">
              <button
                type="button"
                onClick={commitText}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#5A9642] text-xs font-semibold text-white shadow-sm transition hover:bg-[#3F7030]"
              >
                <Send className="h-3.5 w-3.5" />
                Send text
              </button>
              <button
                type="button"
                onClick={commitCall}
                disabled={!pendingContact}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-[#5A9642] text-xs font-semibold text-[#3F7030] shadow-sm transition hover:bg-[#EAF4E4] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                Make call
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // -------- Mail-mode render (unchanged) --------
  return (
    <button
      type="button"
      onClick={onMailClick}
      aria-label="Compose email"
      title="Compose email"
      className="group fixed right-6 bottom-6 z-[1000] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#438631] active:bg-[#39762A] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,154,58,0.35)]"
      style={{ background: "#4F9A3A" }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 bottom-full mb-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        Compose email
      </span>
      <Plus className="h-7 w-7" strokeWidth={2.5} />
    </button>
  );
}
