"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Send,
  Target,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StageBadgeFromName } from "@/components/stage-badge";
import type { PipelineBucket } from "@/lib/rf-payload-shapes";
import { PipelineRowActions } from "@/app/jobs/[id]/pipeline-row-actions";
import { useFindMatches } from "@/lib/find-matches-context";
import { ScoreBadge, normalizeBreakdown } from "@/components/game-plan/score-badge";

export type JobPipelineRow = {
  // Can be either the RF numeric id (RF-imported candidates) or a cuid
  // string (Ace-native candidates whose Placement was written by the
  // applyLocalCandidateToJob path). The href uses it directly so
  // /candidates/[id] works for both.
  candidateId: number | string;
  candidateName: string;
  candidateTitle: string;
  stageName: string;
  bucket: PipelineBucket;
  stageMovedAt: string | null;
};

// Game Plan Phase 2: rows surfaced in the new Matched tab. Sourced
// from CandidateMatch (find-matches stream upserts), keyed on the
// candidate's cuid. Score + rationale are the model's, not a stage —
// Matched lives parallel to the pipeline buckets, not inside them.
//
// scoreBreakdown is whatever Prisma returns from the Json column —
// new rows carry the per-axis breakdown Claude emitted; legacy rows
// (written before the column existed) carry null and the popover
// falls back to rendering the rationale.
export type JobMatchedRow = {
  candidateId: string;
  candidateRfId: number | null;
  name: string;
  title: string;
  employer: string;
  location: string;
  score: number;
  rationale: string;
  scoreBreakdown: unknown;
};

// "Matched" sits next to the pipeline buckets in the tab UI but is
// not a PipelineBucket — it's a parallel concept. Keep it out of the
// PipelineBucket union so stage-aware code (canonicalStage,
// PIPELINE_LABELS, etc.) stays untouched.
type ActiveTab = PipelineBucket | "matched";

type BarItem = {
  bucket: PipelineBucket;
  label: string;
  count: number;
  rows: JobPipelineRow[];
};

const STAGE_ORDER: PipelineBucket[] = [
  "applied",
  "sourced",
  "kept",
  "submitted",
  "interviewing",
  "offer",
  "pending_start",
  "hired",
  "rejected",
];

const STAGE_LABELS: Record<PipelineBucket, string> = {
  applied: "Applied",
  sourced: "Sourced",
  kept: "Kept",
  submitted: "Submitted",
  interviewing: "Interviewing",
  offer: "Offer",
  pending_start: "Pending Start",
  hired: "Hired",
  rejected: "Rejected",
  cancelled: "Cancelled",
  other: "Other",
};

// Same green-brand progression as StageBadge so pipeline visuals match across pages.
const STAGE_TONE: Record<PipelineBucket, string> = {
  applied: "border-court-border bg-court-surface-subtle text-court-fg-muted hover:border-court-fg-muted/30",
  sourced: "border-court-border bg-court-surface-subtle text-court-fg-muted hover:border-court-fg-muted/30",
  kept: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300",
  submitted: "border-brand/30 bg-brand-tint text-brand-dark hover:border-brand/60",
  interviewing: "border-brand/40 bg-brand/25 text-brand-dark hover:border-brand/70",
  offer: "border-brand bg-brand/50 text-white hover:bg-brand/60",
  pending_start: "border-brand-dark bg-brand text-white hover:bg-brand-dark",
  hired: "border-brand-dark bg-brand-dark text-white hover:brightness-110",
  rejected: "border-red-200 bg-red-50 text-red-700 hover:border-red-300",
  cancelled: "border-red-300 bg-red-100 text-red-800 hover:border-red-400",
  other: "border-court-border bg-court-surface-subtle text-court-fg-muted hover:border-court-fg-muted/30",
};

export function JobPipelineSummary({
  rows,
  visibleBuckets = STAGE_ORDER,
  jobActions,
  matched,
  compact = false,
}: {
  rows: JobPipelineRow[];
  visibleBuckets?: PipelineBucket[];
  // When true, render a tighter chip row meant to sit above the main
  // page content rather than inside a Pipeline card. Smaller paddings,
  // smaller count number, fewer columns at small widths so the row
  // stays single-line on a normal /jobs/[id] viewport. The expanded
  // bucket / Matched panels below still render at full size.
  compact?: boolean;
  // Optional context for inline action buttons. When omitted (e.g. on the
  // global /pipeline page where the same component is reused) the Actions
  // column is suppressed and the table renders read-only.
  jobActions?: {
    // RF-imported job ids. Carry 0 for Ace-native Jobs — the inline
    // action buttons fall back to "Open profile" for Ace-native
    // candidates (typeof r.candidateId === "string"), and the RF-
    // keyed server actions never fire with a 0 jobRfId.
    jobRfId: number;
    jobCuid?: string | null;
    clientRfId: number;
    clientCuid?: string | null;
    jobTitle: string;
    clientName: string;
  };
  // Game Plan Phase 2: optional Matched tab. When present, an extra
  // tab appears after Rejected showing every CandidateMatch row for
  // the job ordered by score desc. Lives parallel to the pipeline
  // buckets — a candidate can be Matched AND in any other stage at
  // once.
  matched?: {
    rows: JobMatchedRow[];
    jobId: string;
    jobRfId: number | null;
  };
}) {
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);

  const grouped = new Map<PipelineBucket, JobPipelineRow[]>();
  for (const r of rows) {
    const list = grouped.get(r.bucket);
    if (list) list.push(r);
    else grouped.set(r.bucket, [r]);
  }

  const items: BarItem[] = visibleBuckets.map((b) => ({
    bucket: b,
    label: STAGE_LABELS[b],
    count: grouped.get(b)?.length ?? 0,
    rows: grouped.get(b) ?? [],
  }));

  const activeItem =
    activeTab && activeTab !== "matched"
      ? items.find((i) => i.bucket === activeTab) ?? null
      : null;
  const matchedActive = activeTab === "matched";

  // Live Matched rows. Seeded from the server-rendered list; the Find
  // Matches panel bumps `matchesSavedTick[jobId]` in FindMatchesContext
  // when its stream finishes, and the effect below refetches the full
  // row set from /api/game-plan/matched-candidates. Both the badge
  // count and the Matched tab list read from this state, so a stream
  // landing while the tab is open updates the rows in place — no
  // page reload needed. Falls back silently on fetch error: the prior
  // rows stay rendered and the next page nav reconciles.
  const { matchesSavedTick } = useFindMatches();
  const matchedJobId = matched?.jobId ?? null;
  const tick = matchedJobId ? matchesSavedTick[matchedJobId] ?? 0 : 0;
  const [liveMatchedRows, setLiveMatchedRows] = useState<JobMatchedRow[]>(
    matched?.rows ?? [],
  );
  // Re-seed from server props when the underlying job changes — useState
  // only captures the first mount, so without this, switching jobs in
  // the same client navigation would leave stale rows from the prior job.
  useEffect(() => {
    setLiveMatchedRows(matched?.rows ?? []);
  }, [matchedJobId, matched?.rows]);
  useEffect(() => {
    if (!matchedJobId || tick === 0) return;
    let cancelled = false;
    fetch(
      `/api/game-plan/matched-candidates?jobId=${encodeURIComponent(matchedJobId)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (Array.isArray(j?.rows)) setLiveMatchedRows(j.rows as JobMatchedRow[]);
      })
      .catch(() => {
        // Silent fail — the prior rows stay and the next nav reconciles.
      });
    return () => {
      cancelled = true;
    };
  }, [matchedJobId, tick]);
  const liveMatchedCount = liveMatchedRows.length;

  // Compact variant trims chip padding and count font so the whole row
  // fits comfortably above the Job Description / Game Plan content area
  // without taking a full screen of vertical space. Click-to-expand
  // behavior is unchanged.
  const chipBoxClass = compact
    ? "flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-left transition"
    : "flex flex-col items-center justify-center rounded-lg border px-3 py-2 text-center transition";
  const chipLabelClass = compact
    ? "flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider"
    : "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider";
  const chipCountClass = compact
    ? "font-serif text-base font-bold leading-none tabular-nums"
    : "font-serif text-2xl font-bold leading-none";
  const chipGridClass = compact
    ? "flex flex-wrap gap-1.5"
    : "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8";

  return (
    <div>
      <div className={chipGridClass}>
        {items.map((it) => {
          const active = activeTab === it.bucket;
          const clickable = it.count > 0;
          return (
            <button
              type="button"
              key={it.bucket}
              disabled={!clickable}
              onClick={() => setActiveTab(active ? null : it.bucket)}
              className={cn(
                chipBoxClass,
                STAGE_TONE[it.bucket],
                active && "ring-2 ring-offset-1 ring-brand/40",
                !clickable && "opacity-60 cursor-default hover:border-inherit",
              )}
            >
              <span className={chipLabelClass}>
                {clickable && (active ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                {it.label}
              </span>
              <span className={chipCountClass}>{it.count}</span>
            </button>
          );
        })}
        {matched && (
          <button
            type="button"
            disabled={liveMatchedCount === 0}
            onClick={() =>
              setActiveTab(matchedActive ? null : "matched")
            }
            className={cn(
              chipBoxClass,
              "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400",
              matchedActive && "ring-2 ring-offset-1 ring-brand/40",
              liveMatchedCount === 0 &&
                "opacity-60 cursor-default hover:border-inherit",
            )}
          >
            <span className={chipLabelClass}>
              {liveMatchedCount > 0 &&
                (matchedActive ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                ))}
              Matched
            </span>
            <span className={chipCountClass}>{liveMatchedCount}</span>
          </button>
        )}
      </div>

      {matchedActive && matched && liveMatchedRows.length > 0 && (
        <MatchedTabContent
          rows={liveMatchedRows}
          jobId={matched.jobId}
          jobRfId={matched.jobRfId}
          onClose={() => setActiveTab(null)}
        />
      )}

      {activeItem && activeItem.count > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-court-border bg-court-surface">
          <div className="flex items-center justify-between border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <span>
              {activeItem.label} · {activeItem.count} {activeItem.count === 1 ? "candidate" : "candidates"}
            </span>
            <button
              type="button"
              className="text-court-fg-muted hover:text-court-fg"
              onClick={() => setActiveTab(null)}
            >
              Close
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-court-border text-[11px] uppercase tracking-wider text-court-fg-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Candidate</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Last Action</th>
                {jobActions && <th className="px-4 py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border">
              {activeItem.rows.map((r) => (
                <tr key={r.candidateId} className="transition hover:bg-brand-tint/40">
                  <td className="px-4 py-2">
                    <Link href={`/candidates/${r.candidateId}`} className="font-medium text-court-fg hover:text-brand-dark">
                      {r.candidateName}
                    </Link>
                    <div className="text-xs text-court-fg-muted">{r.candidateTitle || "—"}</div>
                  </td>
                  <td className="px-4 py-2">
                    <StageBadgeFromName stageName={r.stageName} />
                  </td>
                  <td className="px-4 py-2 text-xs text-court-fg-muted">{formatDate(r.stageMovedAt)}</td>
                  {jobActions && typeof r.candidateId === "number" && (
                    <td className="px-4 py-2">
                      <PipelineRowActions
                        candidateRfId={r.candidateId}
                        candidateName={r.candidateName}
                        jobRfId={jobActions.jobRfId}
                        clientRfId={jobActions.clientRfId}
                        jobTitle={jobActions.jobTitle}
                        clientName={jobActions.clientName}
                        stage={r.bucket}
                      />
                    </td>
                  )}
                  {jobActions && typeof r.candidateId === "string" && (
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/candidates/${r.candidateId}`}
                        className="text-xs text-court-fg-muted underline-offset-2 hover:text-court-fg hover:underline"
                      >
                        Open profile
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MATCHED_PAGE_SIZE = 5;

function MatchedTabContent({
  rows,
  jobId,
  jobRfId,
  onClose,
}: {
  rows: JobMatchedRow[];
  jobId: string;
  jobRfId: number | null;
  onClose: () => void;
}) {
  // Page is 1-indexed for display; reset on every fresh mount of this
  // component, which already happens when the recruiter opens or
  // re-opens the Matched tab (the parent gates rendering on
  // matchedActive, so toggling the tab unmounts/remounts).
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / MATCHED_PAGE_SIZE));
  // If the row set shrinks (a new stream replaces the rows after
  // /api/game-plan/matched-candidates refetch), clamp the page so a
  // stale higher page index doesn't strand the user on an empty page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const start = (page - 1) * MATCHED_PAGE_SIZE;
  const visible = rows.slice(start, start + MATCHED_PAGE_SIZE);
  const showPager = rows.length > MATCHED_PAGE_SIZE;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-court-border bg-court-surface">
      <div className="flex items-center justify-between border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
        <span>
          Matched · {rows.length} {rows.length === 1 ? "candidate" : "candidates"}
        </span>
        <button
          type="button"
          className="text-court-fg-muted hover:text-court-fg"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <ul className="divide-y divide-court-border">
        {visible.map((m) => (
          <li key={m.candidateId} className="px-4 py-3">
            <MatchedRowItem row={m} jobId={jobId} jobRfId={jobRfId} />
          </li>
        ))}
      </ul>
      {showPager && (
        <div className="flex items-center justify-center gap-3 border-t border-court-border bg-court-surface-subtle/30 px-4 py-2 text-[11px] text-court-fg-muted">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="inline-flex items-center rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 transition hover:text-court-fg disabled:opacity-40"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="font-medium tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="inline-flex items-center rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 transition hover:text-court-fg disabled:opacity-40"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function MatchedRowItem({
  row,
  jobId,
  jobRfId,
}: {
  row: JobMatchedRow;
  jobId: string;
  jobRfId: number | null;
}) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // One-click Apply: same contract as the Find Matches panel's Apply
  // button. POST /api/placements with stage APPLIED, no modal, no nav.
  // router.refresh() re-runs the server fetch with the new Placement
  // in place, which excludes this candidate from Matched on the next
  // render — so the row visually leaves the tab.
  async function onApply() {
    setApplyError(null);
    setApplying(true);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: row.candidateId,
          jobId,
          stage: "APPLIED",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) {
        setApplyError(body?.error ?? `Apply failed (${res.status})`);
        setApplying(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Network error");
    } finally {
      setApplying(false);
    }
  }

  // One-click Reject: same shape as Apply but marks the candidate
  // rejected for this job. Surfaces the row in the Rejected pipeline
  // bucket and removes it from Matched on next render.
  async function onReject() {
    setApplyError(null);
    setRejecting(true);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: row.candidateId,
          jobId,
          stage: "REJECTED",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) {
        setApplyError(body?.error ?? `Reject failed (${res.status})`);
        setRejecting(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRejecting(false);
    }
  }

  // Submit: route to the candidate profile's existing Submit modal via
  // the deep-link param the profile already handles. RF-imported jobs
  // get the numeric jobRfId; Ace-native jobs fall back to openSubmit=1
  // (the modal then asks the recruiter to pick a job).
  function onSubmit() {
    const candidatePath = `/candidates/${row.candidateRfId ?? row.candidateId}`;
    if (jobRfId != null) {
      router.push(`${candidatePath}?submit=${jobRfId}`);
    } else {
      router.push(`${candidatePath}?openSubmit=1`);
    }
  }

  const candidatePath = `/candidates/${row.candidateRfId ?? row.candidateId}`;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={candidatePath}
              className="truncate font-semibold text-court-fg hover:text-brand-dark"
            >
              {row.name}
            </Link>
            <ScoreBadge
              score={row.score}
              breakdown={normalizeBreakdown(row.scoreBreakdown, row.rationale)}
            />
          </div>
          {(row.title || row.employer) && (
            <div className="mt-0.5 truncate text-xs text-court-fg-muted">
              {row.title}
              {row.title && row.employer ? " · " : ""}
              {row.employer}
            </div>
          )}
          {row.location && (
            <div className="mt-0.5 text-[11px] text-court-fg-muted">{row.location}</div>
          )}
        </div>
      </div>
      {row.rationale && (
        <p className="mt-2 text-xs leading-relaxed text-court-fg">{row.rationale}</p>
      )}
      {applyError && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {applyError}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={candidatePath}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <ExternalLink className="h-3 w-3" /> View Profile
        </Link>
        <Button
          type="button"
          size="sm"
          variant="apply"
          onClick={onApply}
          disabled={applying || rejecting}
        >
          {applying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Target className="h-3 w-3" />
          )}
          Apply
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={applying || rejecting}
        >
          <Send className="h-3 w-3" /> Submit
        </Button>
        <button
          type="button"
          onClick={onReject}
          disabled={applying || rejecting}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-800 shadow-sm transition hover:bg-red-100 disabled:opacity-60"
        >
          {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
          Reject
        </button>
      </div>
    </div>
  );
}
