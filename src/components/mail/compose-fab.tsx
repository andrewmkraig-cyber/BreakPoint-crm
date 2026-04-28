"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Mail,
  MessageSquare,
  PhoneCall,
  Plus,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { useComposerManager } from "@/lib/composer-manager";
import {
  usePhonePanels,
  type PhoneContact,
} from "@/lib/phone-panels-context";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Global multi-action launcher pinned to the bottom-left corner. The
// previous build had two FABs — one for mail (right) and one for
// phone (left) — which left tooltips clipped against the right edge
// on narrow viewports. This combined version stays on the left so the
// tooltip + popover always have horizontal room, and the click opens
// a four-option chooser:
//
//   - New Email   → existing mail composer (candidate-aware on
//                   /candidates/[id])
//   - New Text    → existing phone Send-Text panel (recent contacts
//                   first, search-as-you-type)
//   - New Call    → existing phone Make-Call panel (same picker,
//                   different commit)
//   - Notes       → small note-taking popup with a profile search
//                   that routes the user to the chosen Candidate /
//                   Client with the note text passed via ?draftNote=
//                   so the destination's note input pre-fills.
//
// Templates + the signed-in user's name are loaded on demand from
// /api/mail/compose-init (cached at module scope — every popover that
// needs them shares the same promise).

type InitPayload = {
  templates: ActiveTemplateSummary[];
  user: { firstName: string; fullName: string; email?: string };
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

type ProfileHit = {
  kind: "candidate" | "client";
  id: string;
  href: string;
  label: string;
  sublabel: string | null;
};

type ActionView = "menu" | "phone" | "notes";

export function ComposeFAB() {
  const pathname = usePathname();
  const router = useRouter();

  // Open / close state for the FAB's outer popover and the active
  // sub-view (menu vs phone picker vs notes popup). Keeping all three
  // in one component avoids a forest of context plumbing — the whole
  // launcher fits in one popover panel that swaps its body.
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ActionView>("menu");
  // Phone sub-view defaults to text mode but flips to call when the
  // recruiter picks New Call from the menu.
  const [phoneMode, setPhoneMode] = useState<"text" | "call">("text");

  const popoverRef = useRef<HTMLDivElement | null>(null);

  const composer = useComposerManager();
  const phonePanels = usePhonePanels();

  // Mail-only context: when on /candidates/[id], pre-fill the To field
  // and pass the candidate ref through to the composer so smart
  // context (active jobs / merge tags) lights up.
  const [contextEmail, setContextEmail] = useState("");
  const [contextRef, setContextRef] = useState("");
  useEffect(() => {
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
        // Silent: composer still opens, just without the prefill.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Phone picker state — recent threads list + search filter +
  // pending selection. Loaded on demand when the phone view is
  // entered so the FAB doesn't pay the round-trip on every page load.
  const [recentThreads, setRecentThreads] = useState<RecentThread[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState("");
  const [pendingContact, setPendingContact] = useState<PhoneContact | null>(
    null,
  );
  const phoneSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || view !== "phone") return;
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
  }, [open, view]);

  useEffect(() => {
    if (open && view === "phone") {
      const t = setTimeout(() => phoneSearchInputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, view]);

  const filteredRecents = useMemo(() => {
    const q = phoneSearch.trim().toLowerCase();
    if (!q) return recentThreads;
    return recentThreads.filter(
      (t) =>
        t.contactName.toLowerCase().includes(q) ||
        t.phoneNumber.includes(q),
    );
  }, [phoneSearch, recentThreads]);

  // Notes popup state: free-text body + profile-search query + the
  // current set of hits split into candidates / clients. Picking a
  // result selects the target (highlight only) — the actual write
  // happens on Add-to-profile click. This two-step is deliberate:
  // the recruiter often refines the search to verify they have the
  // right person before committing.
  const [noteText, setNoteText] = useState("");
  const [noteSearch, setNoteSearch] = useState("");
  const [noteResults, setNoteResults] = useState<{
    candidates: ProfileHit[];
    clients: ProfileHit[];
  }>({ candidates: [], clients: [] });
  const [noteSearching, setNoteSearching] = useState(false);
  const [noteTarget, setNoteTarget] = useState<ProfileHit | null>(null);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (open && view === "notes") {
      const t = setTimeout(() => noteTextareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, view]);
  useEffect(() => {
    if (!open || view !== "notes") return;
    const q = noteSearch.trim();
    if (!q) {
      setNoteResults({ candidates: [], clients: [] });
      return;
    }
    let cancelled = false;
    setNoteSearching(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/search/profiles?q=${encodeURIComponent(q)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const body = (await res.json().catch(() => null)) as
            | { candidates?: ProfileHit[]; clients?: ProfileHit[] }
            | null;
          if (!cancelled && body) {
            setNoteResults({
              candidates: body.candidates ?? [],
              clients: body.clients ?? [],
            });
          }
        } catch {
          // Silent: empty list reads as "no matches."
        } finally {
          if (!cancelled) setNoteSearching(false);
        }
      })();
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, view, noteSearch]);

  // Outside-click + Escape dismiss for the whole popover. Keeping the
  // listeners attached only while the popover is mounted avoids a
  // global keydown handler when the FAB is closed.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAll();
    }
    function onClick(e: MouseEvent) {
      const node = popoverRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        closeAll();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function closeAll() {
    setOpen(false);
    setView("menu");
    setPendingContact(null);
    setPhoneSearch("");
    setNoteText("");
    setNoteSearch("");
    setNoteResults({ candidates: [], clients: [] });
    setNoteTarget(null);
    setNoteSubmitting(false);
  }

  async function pickEmail() {
    closeAll();
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
    } catch {
      // Silent: composer manager toasts its own failures.
    }
  }

  function pickText() {
    setPhoneMode("text");
    setView("phone");
  }

  function pickCall() {
    setPhoneMode("call");
    setView("phone");
  }

  function pickNotes() {
    setView("notes");
  }

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
    closeAll();
  }

  function commitCall() {
    if (!pendingContact) return;
    phonePanels.openCall(pendingContact);
    closeAll();
  }

  function selectProfileForNote(hit: ProfileHit) {
    // Highlight-only: actual persistence happens when the user
    // clicks Add to profile. Lets the recruiter type → search →
    // verify → commit instead of clobbering on the first list click.
    setNoteTarget(hit);
  }

  async function commitNote() {
    if (!noteTarget) return;
    const trimmed = noteText.trim();
    if (!trimmed) return;
    setNoteSubmitting(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: noteTarget.kind,
          entityId: noteTarget.id,
          note: trimmed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.error ?? `HTTP ${res.status}`;
        // Fail loud — the toast layer is mounted at Providers; we use
        // dynamic import only because sonner's toast is a side-effect
        // import this file otherwise wouldn't carry.
        const { toast } = await import("sonner");
        toast.error("Couldn't save note", { description: msg });
        return;
      }
      const { toast } = await import("sonner");
      toast.success(`Note added to ${noteTarget.label}`);
      const sep = noteTarget.href.includes("?") ? "&" : "?";
      const target =
        noteTarget.kind === "candidate"
          ? `${noteTarget.href}${sep}tab=notes`
          : `${noteTarget.href}${sep}tab=notes`;
      closeAll();
      router.push(target);
    } catch (e) {
      const { toast } = await import("sonner");
      toast.error("Couldn't save note", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setNoteSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (open) closeAll();
          else {
            setOpen(true);
            setView("menu");
          }
        }}
        aria-label="New email, text, call, or note"
        aria-expanded={open}
        title="New…"
        // Header-sized round button (h-9 to match avatar / sign-out
        // chips next to it) so it lives cleanly inline with the
        // user-info cluster instead of overlapping the bottom-right
        // BreakPoint footer block. No fixed positioning — the parent
        // (TopBar) handles placement.
        className="group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#438631] active:bg-[#39762A] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,154,58,0.35)]"
        style={{
          background: "#4F9A3A",
          transform: open ? "rotate(45deg)" : undefined,
          transitionDuration: "160ms",
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-md bg-court-fg px-2 py-1 text-xs font-medium text-court-surface opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{ transform: open ? "rotate(-45deg)" : undefined }}
        >
          New…
        </span>
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Quick action"
          // Anchored to the top-right under the header (h-16 = top-16)
          // since the trigger now sits in the user-info cluster on the
          // right side of the TopBar.
          className="fixed right-6 top-[68px] z-[1001] w-80 rounded-xl border border-court-border bg-court-surface shadow-2xl"
        >
          {view === "menu" && (
            <div className="p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                  New…
                </span>
                <button
                  type="button"
                  onClick={closeAll}
                  aria-label="Close"
                  className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ActionRow
                icon={<Mail className="h-4 w-4" />}
                label="New Email"
                hint="Compose & send"
                onClick={pickEmail}
              />
              <ActionRow
                icon={<MessageSquare className="h-4 w-4" />}
                label="New Text"
                hint="Pick a recent contact"
                onClick={pickText}
              />
              <ActionRow
                icon={<PhoneCall className="h-4 w-4" />}
                label="New Call"
                hint="Pick a recent contact"
                onClick={pickCall}
              />
              <ActionRow
                icon={<StickyNote className="h-4 w-4" />}
                label="Notes"
                hint="Quick note + attach to a profile"
                onClick={pickNotes}
              />
            </div>
          )}

          {view === "phone" && (
            <div className="p-3">
              <div className="flex items-center justify-between pb-2">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg"
                >
                  ← Back
                </button>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                  {phoneMode === "call" ? "New call" : "New text"}
                </span>
                <button
                  type="button"
                  onClick={closeAll}
                  aria-label="Close"
                  className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
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
                      const active =
                        pendingContact?.candidateId === t.candidateId;
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
                                {t.contactName ||
                                  t.phoneNumber ||
                                  "(unknown)"}
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
                {phoneMode === "call" ? (
                  <button
                    type="button"
                    onClick={commitCall}
                    disabled={!pendingContact}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#5A9642] text-xs font-semibold text-white shadow-sm transition hover:bg-[#3F7030] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                    Make call
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={commitText}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#5A9642] text-xs font-semibold text-white shadow-sm transition hover:bg-[#3F7030]"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Send text
                  </button>
                )}
              </div>
            </div>
          )}

          {view === "notes" && (
            <div className="p-3">
              <div className="flex items-center justify-between pb-2">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="text-[11px] font-medium text-court-fg-muted transition hover:text-court-fg"
                >
                  ← Back
                </button>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
                  Quick note
                </span>
                <button
                  type="button"
                  onClick={closeAll}
                  aria-label="Close"
                  className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <textarea
                ref={noteTextareaRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={4}
                placeholder="Type your note, then pick a profile and click Add to profile."
                className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted/60 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
                <input
                  type="search"
                  value={noteSearch}
                  onChange={(e) => setNoteSearch(e.target.value)}
                  placeholder="Type a candidate or client name..."
                  aria-label="Search profiles"
                  className="h-9 w-full rounded-md border border-court-border bg-court-surface pl-8 pr-2 text-sm text-court-fg outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto">
                {noteSearch.trim() === "" ? (
                  <div className="px-2 py-3 text-xs text-court-fg-muted">
                    Start typing to search candidates and clients.
                  </div>
                ) : noteSearching ? (
                  <div className="px-2 py-3 text-xs text-court-fg-muted">
                    Searching…
                  </div>
                ) : noteResults.candidates.length === 0 &&
                  noteResults.clients.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-court-fg-muted">
                    No matching profiles.
                  </div>
                ) : (
                  <>
                    {noteResults.candidates.length > 0 && (
                      <>
                        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                          Candidates
                        </div>
                        <ul className="space-y-0.5">
                          {noteResults.candidates.map((c) => (
                            <ProfileResultRow
                              key={`cand-${c.id}`}
                              hit={c}
                              selected={
                                noteTarget?.kind === c.kind &&
                                noteTarget?.id === c.id
                              }
                              onPick={() => selectProfileForNote(c)}
                            />
                          ))}
                        </ul>
                      </>
                    )}
                    {noteResults.clients.length > 0 && (
                      <>
                        <div className="mt-2 px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                          Clients
                        </div>
                        <ul className="space-y-0.5">
                          {noteResults.clients.map((c) => (
                            <ProfileResultRow
                              key={`cli-${c.id}`}
                              hit={c}
                              selected={
                                noteTarget?.kind === c.kind &&
                                noteTarget?.id === c.id
                              }
                              onPick={() => selectProfileForNote(c)}
                            />
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-court-border pt-3">
                <span className="min-w-0 truncate text-[11px] text-court-fg-muted">
                  {noteTarget
                    ? `Adding to ${noteTarget.label}`
                    : "Pick a profile to attach this note."}
                </span>
                <button
                  type="button"
                  onClick={commitNote}
                  disabled={
                    noteSubmitting ||
                    !noteTarget ||
                    !noteText.trim()
                  }
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#5A9642] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#3F7030] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {noteSubmitting ? "Adding…" : "Add to profile"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-court-surface-subtle"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-court-surface-subtle text-court-fg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-court-fg">
          {label}
        </span>
        <span className="block truncate text-[11px] text-court-fg-muted">
          {hint}
        </span>
      </span>
    </button>
  );
}

function ProfileResultRow({
  hit,
  onPick,
  selected,
}: {
  hit: ProfileHit;
  onPick: () => void;
  selected?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={selected}
        className={
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition " +
          (selected
            ? "bg-[#EAF4E4] text-[#3F7030]"
            : "text-court-fg hover:bg-court-surface-subtle")
        }
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{hit.label}</span>
          {hit.sublabel && (
            <span className="block truncate text-[11px] text-court-fg-muted">
              {hit.sublabel}
            </span>
          )}
        </span>
        <span
          className={
            "shrink-0 rounded-sm px-1 py-0.5 text-[10px] uppercase tracking-wider " +
            (selected
              ? "bg-[#5A9642]/20 text-[#3F7030]"
              : "bg-court-surface-subtle text-court-fg-muted")
          }
        >
          {hit.kind === "candidate" ? "Candidate" : "Client"}
        </span>
      </button>
    </li>
  );
}
