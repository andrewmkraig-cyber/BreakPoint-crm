"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import {
  quickSearchGlobal,
  type QuickClientRow,
  type QuickContactRow,
  type QuickSearchRow,
} from "@/app/candidates/actions";
import { setCandidateNavList } from "@/lib/candidate-nav";

// Phase 5.4: global quick-search across candidates + clients + contacts.
// Lives in the TopBar, visible on every route. Debounced 300ms. Up to
// 8 total dropdown rows split round-robin across the three groups so
// the dropdown stays balanced regardless of which entity the query
// weights toward.
//
// Keyboard:
//   - Typing in the input shows matches.
//   - ArrowDown / ArrowUp walk the flat result order (candidates
//     first, then clients, then contacts).
//   - Enter navigates to the highlighted row.
//   - Escape closes the dropdown and clears the input.
//   - Click outside closes the dropdown; input keeps whatever you typed.
const DEBOUNCE_MS = 300;

type ResultItem =
  | { kind: "candidate"; id: string; name: string; title: string; employer: string }
  | { kind: "client"; slug: string; name: string; city: string }
  | { kind: "contact"; id: string; name: string; companyName: string; clientSlug: string };

export function TopBarSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<QuickSearchRow[]>([]);
  const [clients, setClients] = useState<QuickClientRow[]>([]);
  const [contacts, setContacts] = useState<QuickContactRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const reqToken = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Flat list powering keyboard nav + the href on Enter. Order in the
  // dropdown: candidates → clients → contacts, so arrow-down walks
  // "my first match" first.
  const flatResults = useMemo<ResultItem[]>(() => {
    const out: ResultItem[] = [];
    for (const c of candidates) {
      out.push({ kind: "candidate", id: c.id, name: c.name, title: c.title, employer: c.employer });
    }
    for (const c of clients) {
      out.push({ kind: "client", slug: c.slug, name: c.name, city: c.city });
    }
    for (const c of contacts) {
      out.push({ kind: "contact", id: c.id, name: c.name, companyName: c.companyName, clientSlug: c.clientSlug });
    }
    return out;
  }, [candidates, clients, contacts]);

  const runSearch = useCallback(async (query: string) => {
    const myToken = ++reqToken.current;
    if (query.trim().length === 0) {
      setCandidates([]);
      setClients([]);
      setContacts([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const res = await quickSearchGlobal(query);
    if (myToken !== reqToken.current) return; // superseded by a newer keystroke
    setIsSearching(false);
    if (res.ok) {
      setCandidates(res.candidates);
      setClients(res.clients);
      setContacts(res.contacts);
      setHighlight(0);
    } else {
      setCandidates([]);
      setClients([]);
      setContacts([]);
    }
  }, []);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q, runSearch]);

  // Click-outside closes the dropdown without clearing the input — the
  // recruiter can click back into the field to continue refining.
  useEffect(() => {
    if (!isOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [isOpen]);

  function navigate(item: ResultItem) {
    setIsOpen(false);
    setQ("");
    if (item.kind === "candidate") {
      // Stash the candidate id list from the current global-search
      // dropdown so the profile's Prev/Next can walk those matches.
      // Skips any non-candidate rows (clients / contacts in the same
      // dropdown) — those don't belong in candidate navigation.
      setCandidateNavList({
        source: "candidates",
        backHref: "/candidates",
        ids: candidates.map((c) => c.id),
      });
      router.push(`/candidates/${item.id}`);
    } else if (item.kind === "client") {
      router.push(`/clients/${item.slug}`);
    } else {
      // Contacts live on a client profile — navigate to the parent
      // client. If the contact somehow has no linked client, fall
      // back to the clients index rather than a dead /clients/ URL.
      router.push(item.clientSlug ? `/clients/${item.clientSlug}?tab=contacts` : "/clients");
    }
    // Clear the in-memory result lists AFTER stashing so the snapshot
    // captures the dropdown's actual contents at click time.
    setCandidates([]);
    setClients([]);
    setContacts([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setIsOpen(false);
      setQ("");
      setCandidates([]);
      setClients([]);
      setContacts([]);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen || flatResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flatResults[highlight];
      if (pick) navigate(pick);
    }
  }

  const hasQuery = q.trim().length > 0;
  const showDropdown = isOpen && (hasQuery || flatResults.length > 0);
  const candidateStart = 0;
  const clientStart = candidates.length;
  const contactStart = candidates.length + clients.length;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search candidates & clients…"
          aria-label="Global search"
          // Autocomplete off + unusual name stops Chrome from filling this
          // with the recruiter's stored profile.
          autoComplete="off"
          name="__breakpoint-quick-search"
          className="w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-transparent py-2 pl-10 pr-10 text-sm text-court-fg placeholder:text-court-fg-muted focus:outline-none"
        />
        {isSearching && (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-court-fg-muted" />
        )}
      </div>

      {showDropdown && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-court-border bg-court-surface shadow-lg"
        >
          {flatResults.length === 0 && !isSearching && hasQuery && (
            <div className="px-4 py-3 text-xs text-court-fg-muted">No matches</div>
          )}

          {candidates.length > 0 && (
            <>
              <div className="border-b border-court-border bg-court-surface-subtle/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                Candidates
              </div>
              {candidates.map((c, i) => {
                const idx = candidateStart + i;
                return (
                  <button
                    key={`cand-${c.id}`}
                    type="button"
                    role="option"
                    aria-selected={idx === highlight}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => navigate({ kind: "candidate", ...c })}
                    className={
                      "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm transition " +
                      (idx === highlight
                        ? "bg-court-accent-tint/60 text-court-fg"
                        : "text-court-fg hover:bg-court-accent-tint/40")
                    }
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-court-fg-muted">
                      {[c.title, c.employer].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {clients.length > 0 && (
            <>
              <div className="border-b border-t border-court-border bg-court-surface-subtle/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                Clients
              </div>
              {clients.map((c, i) => {
                const idx = clientStart + i;
                return (
                  <button
                    key={`cli-${c.slug}`}
                    type="button"
                    role="option"
                    aria-selected={idx === highlight}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => navigate({ kind: "client", ...c })}
                    className={
                      "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm transition " +
                      (idx === highlight
                        ? "bg-court-accent-tint/60 text-court-fg"
                        : "text-court-fg hover:bg-court-accent-tint/40")
                    }
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-court-fg-muted">{c.city || "—"}</span>
                  </button>
                );
              })}
            </>
          )}

          {contacts.length > 0 && (
            <>
              <div className="border-b border-t border-court-border bg-court-surface-subtle/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                Contacts
              </div>
              {contacts.map((c, i) => {
                const idx = contactStart + i;
                return (
                  <button
                    key={`con-${c.id}`}
                    type="button"
                    role="option"
                    aria-selected={idx === highlight}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => navigate({ kind: "contact", ...c })}
                    className={
                      "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm transition " +
                      (idx === highlight
                        ? "bg-court-accent-tint/60 text-court-fg"
                        : "text-court-fg hover:bg-court-accent-tint/40")
                    }
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-court-fg-muted">{c.companyName || "—"}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
