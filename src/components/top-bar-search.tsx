"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { quickSearchCandidates, type QuickSearchRow } from "@/app/candidates/actions";

// Phase 5.1: global quick-search for candidates. Lives in the TopBar,
// visible on every route. Debounced 300ms. Up to 8 dropdown rows with
// name + title + employer. Keyboard:
//   - Typing in the input shows matches.
//   - ArrowDown / ArrowUp move highlight.
//   - Enter navigates to the highlighted row.
//   - Escape closes the dropdown and clears the input.
//   - Click outside closes the dropdown.
const DEBOUNCE_MS = 300;

export function TopBarSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<QuickSearchRow[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const reqToken = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const runSearch = useCallback(async (query: string) => {
    const myToken = ++reqToken.current;
    if (query.trim().length === 0) {
      setRows([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const res = await quickSearchCandidates(query);
    if (myToken !== reqToken.current) return; // a newer keystroke superseded this
    setIsSearching(false);
    if (res.ok) {
      setRows(res.rows);
      setHighlight(0);
    } else {
      setRows([]);
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

  function navigate(id: string) {
    setIsOpen(false);
    setQ("");
    setRows([]);
    router.push(`/candidates/${id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setIsOpen(false);
      setQ("");
      setRows([]);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen || rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = rows[highlight];
      if (pick) navigate(pick.id);
    }
  }

  const showDropdown = isOpen && (q.trim().length > 0 || rows.length > 0);

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
          placeholder="Search candidates…"
          aria-label="Global candidate search"
          // Autocomplete off + unusual name stops Chrome from filling this
          // with the recruiter's stored profile.
          autoComplete="off"
          name="__breakpoint-quick-search"
          className="w-full rounded-lg border border-court-border bg-court-surface-subtle py-2 pl-10 pr-10 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:bg-court-surface focus:outline-none"
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
          {rows.length === 0 && !isSearching && q.trim().length > 0 && (
            <div className="px-4 py-3 text-xs text-court-fg-muted">No candidates match your search</div>
          )}
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => navigate(r.id)}
              className={
                "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm transition " +
                (i === highlight
                  ? "bg-court-accent-tint/60 text-court-fg"
                  : "text-court-fg hover:bg-court-accent-tint/40")
              }
            >
              <span className="font-medium">{r.name}</span>
              <span className="text-xs text-court-fg-muted">
                {[r.title, r.employer].filter(Boolean).join(" · ") || "—"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
