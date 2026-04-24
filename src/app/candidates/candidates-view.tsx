"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { searchCandidates } from "@/app/candidates/actions";

type Candidate = {
  id: string;
  name: string;
  title: string;
  employer: string;
  location: string;
  updatedAt: string | null;
};

// Phase 5.1: debounced, in-place candidate search. The initial SSR
// load seeds `rows`; typing kicks off a 300ms-debounced server action
// that swaps the row list without navigating. URL is left alone —
// no ?q= on the address bar, no router.push, no page flash.
const DEBOUNCE_MS = 300;

export function CandidatesView({
  initialQuery,
  candidates,
  error,
}: {
  initialQuery: string;
  candidates: Candidate[];
  error: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [rows, setRows] = useState<Candidate[]>(candidates);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Track the latest search token so out-of-order responses don't
  // overwrite a newer result with a staler one (e.g. slow "foo" lands
  // after fast "fooba").
  const reqToken = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string) => {
    const myToken = ++reqToken.current;
    setIsSearching(true);
    setSearchError(null);
    const res = await searchCandidates(query);
    if (myToken !== reqToken.current) return; // superseded by a newer keystroke
    setIsSearching(false);
    if (!res.ok) {
      setSearchError(res.error);
      return;
    }
    setRows(res.candidates);
  }, []);

  useEffect(() => {
    // Skip the effect on initial mount when q matches the SSR seed —
    // the server already returned those rows; re-running would be a
    // wasted round-trip.
    if (q === initialQuery && rows === candidates) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // Intentional: rows/initialQuery/candidates are only read on
    // first mount to bypass the initial search. The identity check
    // above handles re-renders. Only q should drive this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, runSearch]);

  const countLabel = rows.length === 0
    ? "No candidates"
    : `${rows.length.toLocaleString()} candidate${rows.length === 1 ? "" : "s"}${q ? ` matching "${q}"` : ""}`;

  return (
    <div className="space-y-4">
      <div className="text-xs text-court-fg-muted">{countLabel}</div>
      <div className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface p-3 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, employer, or title"
            aria-label="Search candidates"
            // Focus state lifts the input background from surface-subtle to
            // surface — Hard: bg-muted → bg-white; Clay / Grass: a subtle
            // step from the slightly-lighter surface-subtle down to the
            // deeper surface.
            className="w-full rounded-lg border border-transparent bg-court-surface-subtle py-2 pl-10 pr-10 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:bg-court-surface focus:outline-none"
          />
          {isSearching && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-court-fg-muted" />
          )}
        </div>
      </div>

      {(error || searchError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load candidates.</div>
          <div className="mt-1 font-mono text-xs">{error ?? searchError}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Current Title</th>
              <th className="px-5 py-3 font-medium">Employer</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-court-border">
            {rows.length === 0 && !error && !searchError && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-court-fg-muted">
                  {q ? "No candidates match your search" : "No candidates"}
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer transition hover:bg-court-accent-tint/40"
                onClick={() => router.push(`/candidates/${c.id}`)}
              >
                <td className="px-5 py-3 font-medium text-court-fg">
                  <Link
                    href={`/candidates/${c.id}`}
                    className="hover:text-court-accent-dark"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-court-fg-muted">{c.title || "—"}</td>
                <td className="px-5 py-3 text-court-fg-muted">{c.employer || "—"}</td>
                <td className="px-5 py-3 text-court-fg-muted">{c.location || "—"}</td>
                <td className="px-5 py-3 text-court-fg-muted">
                  {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
