"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";
import { Pagination } from "@/components/pagination/pagination";

type Candidate = {
  id: string;
  name: string;
  title: string;
  employer: string;
  location: string;
  updatedAt: string | null;
};

// Phase 5A.3: URL-driven candidates list. Search query AND page number
// both live in the URL (?q=…&page=…) so refresh / back / direct-link
// behavior is correct. The component pushes URL changes through
// router.replace inside startTransition so React shows the existing
// rows while the new page renders server-side. No flicker, no
// debounced server action.
//
// Search debounces 300ms before pushing to the URL — typing fast
// doesn't fire one navigation per keystroke.
const DEBOUNCE_MS = 300;

export function CandidatesView({
  initialQuery,
  candidates,
  total,
  page,
  pageSize,
  error,
}: {
  initialQuery: string;
  candidates: Candidate[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedQuery = useRef(initialQuery);

  // When the user types, push the new query to the URL after the
  // debounce. Always reset to page 1 on a search change — keeping the
  // user on page 5 of the old result set after they typed a new query
  // would land them on a confusing slice.
  useEffect(() => {
    if (q === lastPushedQuery.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastPushedQuery.current = q;
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const url = params.toString() ? `/candidates?${params.toString()}` : "/candidates";
      startTransition(() => router.replace(url));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q, router]);

  // Also push the URL if initialQuery changes (e.g., user hit back/
  // forward and the server prop updated). Sync local q to the new
  // initial so we don't immediately re-push.
  useEffect(() => {
    if (initialQuery !== lastPushedQuery.current) {
      lastPushedQuery.current = initialQuery;
      setQ(initialQuery);
    }
  }, [initialQuery]);

  function goToPage(target: number) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (target > 1) params.set("page", String(target));
    const url = params.toString() ? `/candidates?${params.toString()}` : "/candidates";
    startTransition(() => {
      router.push(url);
      // Bring the table into view on page change so the user sees the
      // new rows without scrolling back up.
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface p-3 shadow-sm md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, employer, or title"
            aria-label="Search candidates"
            className="w-full rounded-lg border border-transparent bg-court-surface-subtle py-2 pl-10 pr-10 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:bg-court-surface focus:outline-none"
          />
          {isPending && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-court-fg-muted" />
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load candidates.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div
        className={
          "overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm transition " +
          (isPending ? "opacity-60" : "")
        }
      >
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
            {candidates.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-court-fg-muted">
                  {q ? "No candidates match your search" : "No candidates"}
                </td>
              </tr>
            )}
            {candidates.map((c) => (
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

      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          isLoading={isPending}
          itemLabel="candidates"
        />
      )}
    </div>
  );
}
