"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  keepCandidateForJob,
  keepLocalCandidateForJob,
  rejectLocalCandidateJob,
  removeKeptCandidate,
  removeLocalKeptCandidate,
} from "@/app/applicants/actions";
import { rejectCandidateJob } from "@/app/candidates/[id]/placement-actions";

// candidateId is polymorphic: RF-imported rows carry the numeric RF id;
// Ace-native rows carry a cuid string. The row-level action buttons
// branch on `typeof candidateId` to pick the right server action.
export type AppliedRow = {
  candidateId: number | string;
  candidateName: string;
  // Phase 2: jobId can be either a legacy numeric RF id or a cuid for
  // Ace-native Jobs. The job detail route accepts both (see
  // getJobByIdentifier) so the JobCell href works for either shape.
  jobId: number | string;
  jobTitle: string;
  jobLocation: string;
  // clientRfId is null for Ace-native Clients; the applicants table
  // only uses it for informational grouping, so keep nullability here.
  clientRfId: number | null;
  clientName: string;
  appliedAt: string | null;
  source: string | null;
};

export type KeptRow = {
  candidateId: number | string;
  candidateName: string;
  jobId: number | string;
  jobTitle: string;
  jobLocation: string;
  clientRfId: number | null;
  clientName: string;
  keptAt: string;
};

// Render the source token coming back from Placement.source / RF
// source_name into a human label for the table cell. Add new mappings
// here as we stamp new sources from elsewhere in the app.
function formatSourceLabel(raw: string | null): string {
  if (!raw) return "—";
  if (raw === "recruiter_applied") return "Recruiter Applied";
  return raw;
}

// Stack the job title + location on one line and the client beneath,
// matching how the Candidate Profile job cards render. Avoid the prior
// "(untitled job)" sentinel — the resolver upstream now falls through
// to a real "Untitled role" label or the override.
function JobCell({
  jobId,
  jobTitle,
  jobLocation,
  clientName,
}: {
  jobId: number | string;
  jobTitle: string;
  jobLocation: string;
  clientName: string;
}) {
  const headLine = jobLocation ? `${jobTitle} - ${jobLocation}` : jobTitle;
  return (
    <div>
      <Link href={`/jobs/${jobId}`} className="font-medium text-court-fg hover:text-court-accent-dark">
        {headLine}
      </Link>
      {clientName && <div className="text-xs text-court-fg-muted">{clientName}</div>}
    </div>
  );
}

type Tab = "applied" | "kept";

type SortKey = "name" | "job" | "when" | "source";
type SortDir = "asc" | "desc";

export function ApplicantsView({
  applied,
  kept,
}: {
  applied: AppliedRow[];
  kept: KeptRow[];
}) {
  const [tab, setTab] = useState<Tab>("applied");
  const [sortKey, setSortKey] = useState<SortKey>("when");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedApplied = useMemo(
    () => sortApplied(applied, sortKey, sortDir),
    [applied, sortKey, sortDir],
  );
  const sortedKept = useMemo(() => sortKept(kept, sortKey, sortDir), [kept, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "when" ? "desc" : "asc");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-court-border">
        <TabButton active={tab === "applied"} onClick={() => setTab("applied")}>
          Applied <span className="ml-1 text-court-fg-muted">({applied.length})</span>
        </TabButton>
        <TabButton active={tab === "kept"} onClick={() => setTab("kept")}>
          Kept <span className="ml-1 text-court-fg-muted">({kept.length})</span>
        </TabButton>
      </div>

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
              <tr>
                <ColHeader label="Candidate" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <ColHeader label="Job" active={sortKey === "job"} dir={sortDir} onClick={() => toggleSort("job")} />
                <ColHeader
                  label={tab === "applied" ? "Date Applied" : "Kept Since"}
                  active={sortKey === "when"}
                  dir={sortDir}
                  onClick={() => toggleSort("when")}
                />
                {tab === "applied" && (
                  <ColHeader label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} />
                )}
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border">
              {tab === "applied" ? (
                sortedApplied.length === 0 ? (
                  <EmptyRow label="No applicants in this view." />
                ) : (
                  sortedApplied.map((r) => (
                    <AppliedRowView key={`${r.candidateId}-${r.jobId}`} row={r} />
                  ))
                )
              ) : sortedKept.length === 0 ? (
                <EmptyRow label="No kept candidates yet." />
              ) : (
                sortedKept.map((r) => <KeptRowView key={`${r.candidateId}-${r.jobId}`} row={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-4 py-2 text-sm font-semibold transition",
        active
          ? "border-court-accent text-court-fg"
          : "border-transparent text-court-fg-muted hover:text-court-fg",
      )}
    >
      {children}
    </button>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={5} className="px-5 py-12 text-center text-sm text-court-fg-muted">
        {label}
      </td>
    </tr>
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
          active ? "text-court-fg" : "text-court-fg-muted hover:text-court-fg",
        )}
      >
        {label}
        {active && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function AppliedRowView({ row }: { row: AppliedRow }) {
  const router = useRouter();
  const [isPending, startChange] = useTransition();

  function runAction(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, successMsg: string) {
    startChange(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error("Action failed", { description: result.error });
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  return (
    <tr className="transition hover:bg-court-accent-tint/40">
      <td className="px-5 py-3 align-top">
        <Link href={`/candidates/${row.candidateId}`} className="font-medium text-court-fg hover:text-court-accent-dark">
          {row.candidateName}
        </Link>
      </td>
      <td className="px-5 py-3 align-top">
        <JobCell
          jobId={row.jobId}
          jobTitle={row.jobTitle}
          jobLocation={row.jobLocation}
          clientName={row.clientName}
        />
      </td>
      <td className="px-5 py-3 align-top text-xs text-court-fg-muted">{formatDate(row.appliedAt)}</td>
      <td className="px-5 py-3 align-top text-sm text-court-fg-muted">{formatSourceLabel(row.source)}</td>
      <td className="px-5 py-3 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          {/* Submit hands off to the candidate profile's submittal
              composer via the ?compose=submittal&jobId=N deep link.
              The actual stage move to "submitted" happens when the
              recruiter hits Send in the composer — clicking Submit
              here used to move the candidate without ever showing
              the email. */}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className="inline-flex items-center justify-center gap-1 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            Submit
          </Link>
          {/* Phase 4b: Keep / Reject fire inline regardless of job
              identity shape. The server actions accept either a numeric
              jobRfId (RF-imported) or a cuid jobId (Ace-native); clients
              pick the right field here. Identical UX for both shapes —
              user stays on /applicants, row hops to the Kept tab (or
              disappears on Reject). */}
          <ActionButton
            disabled={isPending}
            onClick={() => {
              const isAceJob = typeof row.jobId === "string";
              const jobRfId = isAceJob ? null : (row.jobId as number);
              const jobId = isAceJob ? (row.jobId as string) : null;
              const clientRfId = row.clientRfId;
              runAction(
                () =>
                  typeof row.candidateId === "string"
                    ? keepLocalCandidateForJob({
                        candidateId: row.candidateId,
                        jobRfId,
                        clientRfId,
                        jobId,
                      })
                    : keepCandidateForJob({
                        candidateRfId: row.candidateId,
                        jobRfId,
                        clientRfId,
                        jobId,
                      }),
                "Kept",
              );
            }}
          >
            Keep
          </ActionButton>
          <ActionButton
            destructive
            disabled={isPending}
            onClick={() => {
              const isAceJob = typeof row.jobId === "string";
              const jobRfId = isAceJob ? null : (row.jobId as number);
              const jobId = isAceJob ? (row.jobId as string) : null;
              const clientRfId = row.clientRfId;
              runAction(
                () =>
                  typeof row.candidateId === "string"
                    ? rejectLocalCandidateJob({
                        candidateId: row.candidateId,
                        jobRfId,
                        clientRfId,
                        jobId,
                        previousStage: "applied",
                        reason: "",
                      })
                    : rejectCandidateJob({
                        candidateRfId: row.candidateId,
                        jobRfId: jobRfId ?? 0,
                        clientRfId: clientRfId ?? 0,
                        jobCuid: jobId,
                        previousStage: "applied",
                        reason: "",
                      }),
                "Rejected",
              );
            }}
          >
            Reject
          </ActionButton>
        </div>
      </td>
    </tr>
  );
}

function KeptRowView({ row }: { row: KeptRow }) {
  const router = useRouter();
  const [isPending, startChange] = useTransition();

  function runAction(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, successMsg: string) {
    startChange(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error("Action failed", { description: result.error });
        return;
      }
      toast.success(successMsg);
      router.refresh();
    });
  }

  return (
    <tr className="transition hover:bg-court-accent-tint/40">
      <td className="px-5 py-3 align-top">
        <Link href={`/candidates/${row.candidateId}`} className="font-medium text-court-fg hover:text-court-accent-dark">
          {row.candidateName}
        </Link>
      </td>
      <td className="px-5 py-3 align-top">
        <JobCell
          jobId={row.jobId}
          jobTitle={row.jobTitle}
          jobLocation={row.jobLocation}
          clientName={row.clientName}
        />
      </td>
      <td className="px-5 py-3 align-top text-xs text-court-fg-muted">{formatDate(row.keptAt)}</td>
      <td className="px-5 py-3 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          {/* Submit hands off to the candidate profile's submittal
              composer via the deep link. The Kept row gets cleaned up
              after the recruiter sends — the composer's onSend path
              moves the placement to "submitted" which itself excludes
              the row from the Kept query on next refresh. */}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className="inline-flex items-center justify-center gap-1 rounded-full bg-brand px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-brand-dark"
          >
            Submit
          </Link>
          <ActionButton
            destructive
            disabled={isPending}
            onClick={() => {
              const isAceJob = typeof row.jobId === "string";
              const jobRfId = isAceJob ? null : (row.jobId as number);
              const jobId = isAceJob ? (row.jobId as string) : null;
              runAction(
                () =>
                  typeof row.candidateId === "string"
                    ? removeLocalKeptCandidate({
                        candidateId: row.candidateId,
                        jobRfId,
                        jobId,
                      })
                    : removeKeptCandidate({
                        candidateRfId: row.candidateId,
                        jobRfId,
                        jobId,
                      }),
                "Removed",
              );
            }}
          >
            Remove
          </ActionButton>
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
  // Primary (rare here) and Destructive route through the shared
  // Button primitive so the visual hierarchy stays in lockstep with
  // the rest of the app. Neutral (Keep) keeps a slate chip — there's
  // no slate variant on Button by design, so this stays a raw button
  // with the same shape (rounded-full, h-7, font-bold, text-[11px]).
  if (primary) {
    return (
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={onClick}
        disabled={disabled}
        className="h-7 text-[11px] font-bold"
      >
        {children}
      </Button>
    );
  }
  if (destructive) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={onClick}
        disabled={disabled}
        className="h-7 text-[11px] font-bold"
      >
        {children}
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 items-center justify-center whitespace-nowrap rounded-full px-3 text-[11px] font-bold shadow-sm transition disabled:opacity-60",
        "border border-court-border bg-slate-100 text-slate-600 hover:bg-slate-200",
      )}
    >
      {children}
    </button>
  );
}

function sortApplied(rows: AppliedRow[], key: SortKey, dir: SortDir): AppliedRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    let va: string | number = "";
    let vb: string | number = "";
    switch (key) {
      case "name":
        va = a.candidateName.toLowerCase();
        vb = b.candidateName.toLowerCase();
        break;
      case "job":
        va = a.jobTitle.toLowerCase();
        vb = b.jobTitle.toLowerCase();
        break;
      case "when":
        va = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
        vb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
        break;
      case "source":
        va = (a.source ?? "").toLowerCase();
        vb = (b.source ?? "").toLowerCase();
        break;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
  return out;
}

function sortKept(rows: KeptRow[], key: SortKey, dir: SortDir): KeptRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const mul = dir === "asc" ? 1 : -1;
    let va: string | number = "";
    let vb: string | number = "";
    switch (key) {
      case "name":
        va = a.candidateName.toLowerCase();
        vb = b.candidateName.toLowerCase();
        break;
      case "job":
        va = a.jobTitle.toLowerCase();
        vb = b.jobTitle.toLowerCase();
        break;
      case "when":
        va = new Date(a.keptAt).getTime();
        vb = new Date(b.keptAt).getTime();
        break;
      case "source":
        va = 0;
        vb = 0;
        break;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
  return out;
}
