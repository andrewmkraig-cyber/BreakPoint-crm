"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { StageBadgeFromName } from "@/components/stage-badge";
import type { PipelineBucket } from "@/lib/recruiterflow";
import { PipelineRowActions } from "@/app/jobs/[id]/pipeline-row-actions";

export type JobPipelineRow = {
  candidateId: number;
  candidateName: string;
  candidateTitle: string;
  stageName: string;
  bucket: PipelineBucket;
  stageMovedAt: string | null;
};

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
}: {
  rows: JobPipelineRow[];
  visibleBuckets?: PipelineBucket[];
  // Optional context for inline action buttons. When omitted (e.g. on the
  // global /pipeline page where the same component is reused) the Actions
  // column is suppressed and the table renders read-only.
  jobActions?: {
    jobRfId: number;
    clientRfId: number;
    jobTitle: string;
    clientName: string;
  };
}) {
  const [openBucket, setOpenBucket] = useState<PipelineBucket | null>(null);

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

  const activeItem = openBucket ? items.find((i) => i.bucket === openBucket) ?? null : null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {items.map((it) => {
          const active = openBucket === it.bucket;
          const clickable = it.count > 0;
          return (
            <button
              type="button"
              key={it.bucket}
              disabled={!clickable}
              onClick={() => setOpenBucket(active ? null : it.bucket)}
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border px-3 py-2 text-center transition",
                STAGE_TONE[it.bucket],
                active && "ring-2 ring-offset-1 ring-brand/40",
                !clickable && "opacity-60 cursor-default hover:border-inherit",
              )}
            >
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                {clickable && (active ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                {it.label}
              </span>
              <span className="font-serif text-2xl font-bold leading-none">{it.count}</span>
            </button>
          );
        })}
      </div>

      {activeItem && activeItem.count > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-court-border bg-court-surface">
          <div className="flex items-center justify-between border-b border-court-border bg-court-surface-subtle/60 px-4 py-2 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <span>
              {activeItem.label} · {activeItem.count} {activeItem.count === 1 ? "candidate" : "candidates"}
            </span>
            <button
              type="button"
              className="text-court-fg-muted hover:text-court-fg"
              onClick={() => setOpenBucket(null)}
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
                  {jobActions && (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
