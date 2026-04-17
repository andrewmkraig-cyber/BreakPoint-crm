"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { StageBadgeFromName } from "@/components/stage-badge";
import type { PipelineBucket } from "@/lib/recruiterflow";

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
  submitted: "Submitted",
  interviewing: "Interviewing",
  offer: "Offer",
  pending_start: "Pending Start",
  hired: "Hired",
  rejected: "Rejected",
  other: "Other",
};

const STAGE_TONE: Record<PipelineBucket, string> = {
  applied: "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
  sourced: "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
  submitted: "border-brand/30 bg-brand-tint text-brand-dark hover:border-brand/50",
  interviewing: "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300",
  offer: "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300",
  pending_start: "border-purple-200 bg-purple-50 text-purple-700 hover:border-purple-300",
  hired: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300",
  rejected: "border-red-200 bg-red-50 text-red-700 hover:border-red-300",
  other: "border-border bg-muted text-navy-400 hover:border-muted-foreground/30",
};

export function JobPipelineSummary({
  rows,
  visibleBuckets = STAGE_ORDER,
}: {
  rows: JobPipelineRow[];
  visibleBuckets?: PipelineBucket[];
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
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-white">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>
              {activeItem.label} · {activeItem.count} {activeItem.count === 1 ? "candidate" : "candidates"}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-navy"
              onClick={() => setOpenBucket(null)}
            >
              Close
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Candidate</th>
                <th className="px-4 py-2 font-medium">Stage</th>
                <th className="px-4 py-2 font-medium">Last Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activeItem.rows.map((r) => (
                <tr key={r.candidateId} className="transition hover:bg-brand-tint/40">
                  <td className="px-4 py-2">
                    <Link href={`/candidates/${r.candidateId}`} className="font-medium text-navy hover:text-brand-dark">
                      {r.candidateName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.candidateTitle || "—"}</div>
                  </td>
                  <td className="px-4 py-2">
                    <StageBadgeFromName stageName={r.stageName} />
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(r.stageMovedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
