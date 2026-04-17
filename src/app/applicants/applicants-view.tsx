"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { setApplicantStatus, type ApplicantStatusValue } from "@/app/applicants/actions";

export type ApplicantRow = {
  candidateId: number;
  candidateName: string;
  jobId: number;
  jobTitle: string;
  clientName: string;
  appliedAt: string | null;
  source: string | null;
  status: ApplicantStatusValue;
};

type SortKey = "name" | "job" | "applied" | "source" | "status";
type SortDir = "asc" | "desc";

const STATUS_LABEL: Record<ApplicantStatusValue, string> = {
  new: "New",
  reviewed: "Reviewed",
  rejected: "Rejected",
  moved_to_pipeline: "Moved to Pipeline",
};

const STATUS_CLASS: Record<ApplicantStatusValue, string> = {
  new: "bg-brand-tint text-brand-dark",
  reviewed: "bg-blue-50 text-blue-700",
  rejected: "bg-red-50 text-red-700",
  moved_to_pipeline: "bg-emerald-50 text-emerald-700",
};

export function ApplicantsView({ rows }: { rows: ApplicantRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("applied");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      let va: string | number = "";
      let vb: string | number = "";
      switch (sortKey) {
        case "name":
          va = a.candidateName.toLowerCase();
          vb = b.candidateName.toLowerCase();
          break;
        case "job":
          va = a.jobTitle.toLowerCase();
          vb = b.jobTitle.toLowerCase();
          break;
        case "applied":
          va = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
          vb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
          break;
        case "source":
          va = (a.source ?? "").toLowerCase();
          vb = (b.source ?? "").toLowerCase();
          break;
        case "status":
          va = a.status;
          vb = b.status;
          break;
      }
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "applied" ? "desc" : "asc");
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <ColHeader label="Candidate" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
              <ColHeader label="Job" active={sortKey === "job"} dir={sortDir} onClick={() => toggleSort("job")} />
              <ColHeader label="Date Applied" active={sortKey === "applied"} dir={sortDir} onClick={() => toggleSort("applied")} />
              <ColHeader label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} />
              <ColHeader label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No applicants yet.
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <ApplicantRowView key={`${r.candidateId}-${r.jobId}`} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-5 py-3 font-medium">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider",
          active ? "text-navy" : "text-muted-foreground hover:text-navy",
        )}
      >
        {label}
        {active && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function ApplicantRowView({ row }: { row: ApplicantRow }) {
  const router = useRouter();
  const [isPending, startChange] = useTransition();
  const [status, setStatus] = useState<ApplicantStatusValue>(row.status);

  function update(next: ApplicantStatusValue) {
    if (next === status) return;
    startChange(async () => {
      const result = await setApplicantStatus({
        candidateRfId: row.candidateId,
        jobRfId: row.jobId,
        status: next,
      });
      if (!result.ok) {
        toast.error("Couldn't update status", { description: result.error });
        return;
      }
      setStatus(next);
      toast.success(
        next === "moved_to_pipeline"
          ? "Moved to Pipeline"
          : `Marked ${STATUS_LABEL[next].toLowerCase()}`,
      );
      router.refresh();
    });
  }

  return (
    <tr className="transition hover:bg-brand-tint/40">
      <td className="px-5 py-3 align-top">
        <Link href={`/candidates/${row.candidateId}`} className="font-medium text-navy hover:text-brand-dark">
          {row.candidateName}
        </Link>
        {row.clientName && <div className="text-xs text-muted-foreground">{row.clientName}</div>}
      </td>
      <td className="px-5 py-3 align-top">
        <Link href={`/jobs/${row.jobId}`} className="font-medium text-navy hover:text-brand-dark">
          {row.jobTitle || "—"}
        </Link>
      </td>
      <td className="px-5 py-3 align-top text-xs text-muted-foreground">{formatDate(row.appliedAt)}</td>
      <td className="px-5 py-3 align-top text-sm text-navy-400">{row.source || "—"}</td>
      <td className="px-5 py-3 align-top">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
            STATUS_CLASS[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </td>
      <td className="px-5 py-3 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {status !== "reviewed" && status !== "moved_to_pipeline" && (
            <ActionButton onClick={() => update("reviewed")} disabled={isPending}>
              Mark Reviewed
            </ActionButton>
          )}
          {status !== "moved_to_pipeline" && (
            <ActionButton onClick={() => update("moved_to_pipeline")} disabled={isPending} primary>
              Move to Pipeline
            </ActionButton>
          )}
          {status !== "rejected" && status !== "moved_to_pipeline" && (
            <ActionButton onClick={() => update("rejected")} disabled={isPending} destructive>
              Reject
            </ActionButton>
          )}
        </div>
      </td>
    </tr>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 items-center justify-center whitespace-nowrap rounded-full px-3 text-[11px] font-bold shadow-sm transition disabled:opacity-60",
        primary
          ? "bg-brand text-white hover:bg-brand-dark"
          : destructive
            ? "border border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50"
            : "border border-border bg-white text-navy hover:border-brand/40 hover:text-brand-dark",
      )}
    >
      {children}
    </button>
  );
}
