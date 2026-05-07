"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Search, Target } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Boolean candidate search anchored to a specific job. Free-text search
// across name / title / current employer / skills / location, scoped
// server-side to the signed-in tenant. Apply button POSTs the standard
// /api/placements call so the action lands the candidate on the job's
// pipeline at stage APPLIED.
//
// Intentionally minimal — this is the seed of the boolean search; later
// passes will layer structured filters (location radius, comp range,
// experience years, must-have skills) on top of the same input.

type CandidateHit = {
  candidateCuid: string;
  candidateRfId: number | null;
  name: string;
  title: string | null;
  employer: string | null;
  location: string | null;
  skills: string[];
  alreadyApplied: boolean;
};

type SearchResponse =
  | { ok: true; results: CandidateHit[] }
  | { ok: false; error: string };

const SEARCH_DEBOUNCE_MS = 350;

export function MatchesTab({
  jobCuid,
  jobRfId,
  jobTitle,
}: {
  jobCuid: string;
  jobRfId: number | null;
  jobTitle: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CandidateHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Debounced fetch on every keystroke. The seq counter guards against
  // out-of-order responses overwriting fresh state — older queries with
  // a stale seq are dropped instead of clobbering the latest results.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }

    const seq = ++requestSeq.current;
    setSearching(true);
    setError(null);

    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/jobs/search-candidates?jobId=${encodeURIComponent(jobCuid)}&q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" },
        );
        const data = (await res.json().catch(() => null)) as SearchResponse | null;
        if (seq !== requestSeq.current) return;
        if (!data || !data.ok) {
          setError(data && "error" in data ? data.error : `Search failed (${res.status})`);
          setResults([]);
          return;
        }
        setResults(data.results);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : "Network error.");
        setResults([]);
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, jobCuid]);

  return (
    <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-lg font-semibold text-court-fg">Find Candidates</h2>
        <p className="text-[11px] text-court-fg-muted">
          Search across name, title, current employer, skills, and location. Apply lands the
          candidate on this job&apos;s pipeline at the Applied stage.
        </p>
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-court-fg-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. senior tax manager Cleveland, or react fintech remote"
          className={cn(
            "w-full rounded-md border border-court-border bg-court-bg py-2 pl-8 pr-9 text-sm text-court-fg shadow-sm",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
          )}
        />
        {searching && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-court-fg-muted" />
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4">
        {results === null ? (
          <p className="text-xs text-court-fg-muted">
            Type at least two characters to search Neon for candidates.
          </p>
        ) : results.length === 0 ? (
          <p className="text-xs text-court-fg-muted">
            No candidates match {`"${query.trim()}"`} yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-court-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Candidate</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Skills</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-court-border">
                {results.map((r) => (
                  <CandidateRow
                    key={r.candidateCuid}
                    hit={r}
                    jobCuid={jobCuid}
                    jobRfId={jobRfId}
                    jobTitle={jobTitle}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function CandidateRow({
  hit,
  jobCuid,
  jobRfId,
  jobTitle,
}: {
  hit: CandidateHit;
  jobCuid: string;
  jobRfId: number | null;
  jobTitle: string;
}) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(hit.alreadyApplied);

  const profileSlug = hit.candidateRfId ?? hit.candidateCuid;
  const profileHref = `/candidates/${profileSlug}`;

  async function onApply() {
    if (applied) return;
    setApplying(true);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: hit.candidateCuid,
          jobId: jobCuid,
          stage: "APPLIED",
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      const ok =
        res.ok &&
        data &&
        typeof data === "object" &&
        (!("ok" in data) || (data as { ok: boolean }).ok !== false);
      if (!ok) {
        const errMsg =
          data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Apply failed (${res.status})`;
        toast.error("Couldn't apply", { description: errMsg });
        return;
      }
      setApplied(true);
      toast.success(`Applied ${hit.name} to ${jobTitle}`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't apply", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setApplying(false);
    }
  }

  // Suppress the unused-var warning for jobRfId in environments where
  // the deeplink isn't relevant — it's part of the props contract for
  // future structured-search work.
  void jobRfId;

  return (
    <tr className="transition hover:bg-brand-tint/40">
      <td className="px-3 py-2">
        <Link
          href={profileHref}
          className="font-medium text-court-fg hover:text-brand-dark"
        >
          {hit.name}
        </Link>
        {hit.employer && (
          <div className="text-[11px] text-court-fg-muted">at {hit.employer}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-court-fg-muted">
        {hit.title || "—"}
      </td>
      <td className="px-3 py-2 text-xs text-court-fg-muted">
        {hit.location || "—"}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {hit.skills.length === 0 ? (
            <span className="text-[11px] text-court-fg-muted">—</span>
          ) : (
            hit.skills.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded-full border border-court-border bg-court-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted"
              >
                {s}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={profileHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          >
            <ExternalLink className="h-3 w-3" /> Profile
          </Link>
          <Button
            type="button"
            size="sm"
            variant={applied ? "secondary" : "apply"}
            onClick={onApply}
            disabled={applying || applied}
          >
            {applied ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : applying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Target className="h-3 w-3" />
            )}
            {applied ? "Applied" : "Apply to Job"}
          </Button>
        </div>
      </td>
    </tr>
  );
}
