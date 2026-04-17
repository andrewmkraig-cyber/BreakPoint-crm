"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Search, Loader2 } from "lucide-react";

type Candidate = {
  id: number;
  name: string;
  title: string;
  employer: string;
  location: string;
  updatedAt: string | null;
};

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
  const params = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params?.toString() ?? "");
    if (q) next.set("q", q);
    else next.delete("q");
    startTransition(() => {
      router.push(`/candidates?${next.toString()}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        {candidates.length === 0
          ? "No candidates"
          : `${candidates.length.toLocaleString()} candidate${candidates.length === 1 ? "" : "s"}${initialQuery ? ` matching "${initialQuery}"` : ""}`}
      </div>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 shadow-sm md:flex-row md:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, title, employer, location…"
            className="w-full rounded-lg border border-transparent bg-muted py-2 pl-10 pr-3 text-sm text-navy placeholder:text-muted-foreground focus:border-brand focus:bg-white focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load candidates from RecruiterFlow.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Current Title</th>
              <th className="px-5 py-3 font-medium">Employer</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Last Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {candidates.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No candidates returned from RecruiterFlow{initialQuery ? ` for "${initialQuery}"` : ""}.
                </td>
              </tr>
            )}
            {candidates.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer transition hover:bg-brand-tint/40"
                onClick={() => router.push(`/candidates/${c.id}`)}
              >
                <td className="px-5 py-3 font-medium text-navy">
                  <Link
                    href={`/candidates/${c.id}`}
                    className="hover:text-brand-dark"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-navy-400">{c.title || "—"}</td>
                <td className="px-5 py-3 text-navy-400">{c.employer || "—"}</td>
                <td className="px-5 py-3 text-navy-400">{c.location || "—"}</td>
                <td className="px-5 py-3 text-navy-400">
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
