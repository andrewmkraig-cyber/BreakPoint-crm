"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Loader2, Search, Send, UserX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StageBadgeFromName } from "@/components/stage-badge";
import type { JobPipelineTabRow } from "@/lib/job-pipeline-rows";

// Pipeline tab body. The cross-tab chip strip rendered above by
// JobPipelineSummary already gives a count-only summary; this tab adds
// the deeper view: stage filter chips + free-text search + a row
// table with location, days-in-stage, last action, and inline Submit /
// Reject actions per row.

const STAGE_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "sourced", label: "Sourced" },
  { id: "applied", label: "Applied" },
  { id: "submitted", label: "Submitted" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
  { id: "hired", label: "Hired" },
  { id: "rejected", label: "Rejected" },
];

export function PipelineTab({
  rows,
  jobCuid,
  jobRfId,
}: {
  rows: JobPipelineTabRow[];
  jobCuid: string;
  jobRfId: number | null;
}) {
  const [stage, setStage] = useState<string>("all");
  const [query, setQuery] = useState<string>("");

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const key = (r.bucket || r.stageName || "").toLowerCase();
      m[key] = (m[key] ?? 0) + 1;
    }
    m["all"] = rows.length;
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stage !== "all") {
        const rowStage = (r.bucket || r.stageName || "").toLowerCase();
        if (rowStage !== stage) return false;
      }
      if (!q) return true;
      const haystack = [
        r.candidateName,
        r.candidateTitle ?? "",
        r.candidateLocation ?? "",
        r.stageName,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, stage, query]);

  return (
    <section className="rounded-xl border border-court-border bg-court-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_FILTERS.map((f) => {
            const active = stage === f.id;
            const count = counts[f.id] ?? 0;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStage(f.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition",
                  active
                    ? "border-brand bg-brand-tint text-brand-dark ring-1 ring-brand/40"
                    : "border-court-border bg-court-surface-subtle text-court-fg-muted hover:border-brand/40 hover:text-court-fg",
                )}
              >
                {f.label}
                <span className="rounded-full bg-court-surface px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-court-fg-muted">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-court-fg-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search candidates by name, title, or location…"
            className={cn(
              "w-full rounded-md border border-court-border bg-court-bg py-1.5 pl-8 pr-3 text-sm text-court-fg shadow-sm",
              "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
            )}
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-court-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Candidate</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Days</th>
              <th className="px-3 py-2 font-medium">Last action</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-court-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-court-fg-muted">
                  {rows.length === 0
                    ? "No candidates on this job's pipeline yet."
                    : "No matches for this filter."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <PipelineTabRow
                  key={`${r.candidateCuid}:${r.bucket}`}
                  row={r}
                  jobCuid={jobCuid}
                  jobRfId={jobRfId}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PipelineTabRow({
  row,
  jobCuid,
  jobRfId,
}: {
  row: JobPipelineTabRow;
  jobCuid: string;
  jobRfId: number | null;
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);

  const profileSlug = row.candidateRfId ?? row.candidateCuid;
  const profileHref = `/candidates/${profileSlug}`;
  const stageLower = row.stageName.toLowerCase();
  const alreadyRejected = stageLower === "rejected" || stageLower === "cancelled";

  function onSubmit() {
    if (jobRfId != null) {
      router.push(`${profileHref}?submit=${jobRfId}`);
    } else {
      router.push(`${profileHref}?openSubmit=1`);
    }
  }

  async function onReject() {
    if (alreadyRejected) {
      toast.message("Already rejected", {
        description: `${row.candidateName} is already in the ${row.stageName} stage.`,
      });
      return;
    }
    if (!confirm(`Reject ${row.candidateName} for this job?`)) return;
    setRejecting(true);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: row.candidateCuid,
          jobId: jobCuid,
          stage: "REJECTED",
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || (data && typeof data === "object" && "ok" in data && (data as { ok: boolean }).ok === false)) {
        const errMsg =
          data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Reject failed (${res.status})`;
        toast.error("Couldn't reject", { description: errMsg });
        return;
      }
      toast.success(`Rejected ${row.candidateName}`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't reject", {
        description: e instanceof Error ? e.message : "Network error.",
      });
    } finally {
      setRejecting(false);
    }
  }

  const lastActionLabel = row.lastAction?.label ?? "—";
  const lastActionWhen = row.lastAction?.at
    ? formatRelative(row.lastAction.at)
    : null;

  return (
    <tr className="transition hover:bg-brand-tint/40">
      <td className="px-3 py-2">
        <Link
          href={profileHref}
          className="font-medium text-court-fg hover:text-brand-dark"
        >
          {row.candidateName}
        </Link>
        {row.candidateTitle && (
          <div className="text-[11px] text-court-fg-muted">{row.candidateTitle}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-court-fg-muted">
        {row.candidateLocation || "—"}
      </td>
      <td className="px-3 py-2">
        <StageBadgeFromName stageName={row.stageName} />
      </td>
      <td className="px-3 py-2 text-xs tabular-nums text-court-fg-muted">
        {row.daysInStage == null ? "—" : `${row.daysInStage}d`}
      </td>
      <td className="px-3 py-2 text-xs text-court-fg-muted">
        <div className="truncate" title={lastActionLabel}>{lastActionLabel}</div>
        {lastActionWhen && <div className="text-[10px]">{lastActionWhen}</div>}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={rejecting}
          >
            <Send className="h-3 w-3" /> Submit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger"
            onClick={onReject}
            disabled={rejecting || alreadyRejected}
          >
            {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
            Reject
          </Button>
        </div>
      </td>
    </tr>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(day / 365)}y ago`;
}
