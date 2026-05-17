"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bookmark, ChevronDown, ChevronUp, Loader2, Send, UserX, X } from "lucide-react";
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
import { RejectCandidateDialog } from "@/components/reject-candidate-dialog";
import { setCandidateNavList } from "@/lib/candidate-nav";

// candidateId is polymorphic: RF-imported rows carry the numeric RF id;
// Ace-native rows carry a cuid string. The row-level action buttons
// branch on `typeof candidateId` to pick the right server action.
export type AppliedRow = {
  candidateId: number | string;
  candidateName: string;
  jobId: number | string;
  jobTitle: string;
  jobLocation: string;
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

function formatSourceLabel(raw: string | null): string {
  if (!raw) return "—";
  if (raw === "recruiter_applied") return "Recruiter Applied";
  return raw;
}

// Spec rule 2: applied role text-[12px] font-medium hover:text-court-brand-dark.
// Source + date go in a mono 11px muted line on the row, so JobCell now
// only renders the title + location + client name (no metadata).
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
      <Link
        href={`/jobs/${jobId}`}
        className="text-[12px] font-medium text-court-fg hover:text-court-brand-dark"
      >
        {headLine}
      </Link>
      {clientName && (
        <div className="text-[11px] text-court-fg-muted">{clientName}</div>
      )}
    </div>
  );
}

// Spec rule 3 — status pills.
function StatusChip({ status }: { status: "new" | "reviewed" | "rejected" }) {
  const label = status === "new" ? "New" : status === "reviewed" ? "Kept" : "Rejected";
  const cls =
    status === "new"
      ? "bg-court-accent-tint text-court-brand-dark"
      : status === "reviewed"
        ? "bg-court-surface-subtle text-court-fg-muted"
        : "bg-red-50 text-red-500";
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold",
        cls,
      )}
    >
      {label}
    </span>
  );
}

type Tab = "applied" | "kept";

type SortKey = "name" | "job" | "when" | "source";
type SortDir = "asc" | "desc";

function rowKey(r: { candidateId: number | string; jobId: number | string }): string {
  return `${r.candidateId}-${r.jobId}`;
}

async function rejectOneApplicant(
  r: { candidateId: number | string; jobId: number | string; clientRfId: number | null },
  previousStage: "applied" | "kept",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const isAceJob = typeof r.jobId === "string";
  const jobRfId = isAceJob ? null : (r.jobId as number);
  const jobId = isAceJob ? (r.jobId as string) : null;
  const clientRfId = r.clientRfId;
  if (typeof r.candidateId === "string") {
    return rejectLocalCandidateJob({
      candidateId: r.candidateId,
      jobRfId,
      clientRfId,
      jobId,
      previousStage,
      reason: "",
    });
  }
  return rejectCandidateJob({
    candidateRfId: r.candidateId,
    jobRfId: jobRfId ?? 0,
    clientRfId: clientRfId ?? 0,
    jobCuid: jobId,
    previousStage,
    reason: "",
  });
}

export function ApplicantsView({
  applied,
  kept,
}: {
  applied: AppliedRow[];
  kept: KeptRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("applied");
  const [sortKey, setSortKey] = useState<SortKey>("when");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedApplied = useMemo(
    () => sortApplied(applied, sortKey, sortDir),
    [applied, sortKey, sortDir],
  );
  const sortedKept = useMemo(() => sortKept(kept, sortKey, sortDir), [kept, sortKey, sortDir]);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [tab]);

  const visibleRows: Array<AppliedRow | KeptRow> =
    tab === "applied" ? sortedApplied : sortedKept;
  const visibleKeys = useMemo(() => visibleRows.map((r) => rowKey(r)), [visibleRows]);
  const allSelected =
    visibleKeys.length > 0 && visibleKeys.every((k) => selectedKeys.has(k));
  const someSelected = selectedKeys.size > 0 && !allSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelectedKeys((prev) => {
      if (prev.size === visibleKeys.length && visibleKeys.length > 0) {
        return new Set();
      }
      return new Set(visibleKeys);
    });
  }

  async function onBulkRejectConfirm({ sendRejectionEmail: _sendRejectionEmail }: { sendRejectionEmail: boolean }) {
    void _sendRejectionEmail;
    const keys = new Set(selectedKeys);
    if (keys.size === 0) return;
    setBulkBusy(true);
    const previousStage: "applied" | "kept" = tab === "applied" ? "applied" : "kept";
    const targets = visibleRows.filter((r) => keys.has(rowKey(r)));
    let ok = 0;
    let fail = 0;
    for (const r of targets) {
      try {
        const isAceJob = typeof r.jobId === "string";
        const clientRfId = "clientRfId" in r ? r.clientRfId : null;
        const res = await rejectOneApplicant(
          {
            candidateId: r.candidateId,
            jobId: r.jobId,
            clientRfId,
          },
          previousStage,
        );
        if (res.ok) ok += 1;
        else fail += 1;
        void isAceJob;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setBulkRejectOpen(false);
    setSelectedKeys(new Set());
    if (fail === 0) {
      toast.success(`Rejected ${ok}`);
    } else if (ok === 0) {
      toast.error(`Couldn't reject (${fail} failed)`);
    } else {
      toast.warning(`Rejected ${ok}, ${fail} failed`);
    }
    router.refresh();
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const visible = tab === "applied" ? sortedApplied : sortedKept;
    setCandidateNavList({
      source: "applicants",
      backHref: "/applicants",
      ids: visible.map((r) => String(r.candidateId)),
    });
  }, [tab, sortedApplied, sortedKept]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "when" ? "desc" : "asc");
    }
  }

  // Spec rule 5: large serif count + "applicants" muted; zero count
  // dims to text-court-border opacity-50 per rule 6.
  const visibleCount = visibleRows.length;
  const colSpan = tab === "applied" ? 7 : 6;

  return (
    <div className="-m-4 min-h-[calc(100vh-6rem)] bg-court-surface-subtle p-4 sm:-m-6 sm:p-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "font-serif text-[22px] font-extrabold leading-none tabular-nums",
                visibleCount === 0 ? "text-court-border opacity-50" : "text-court-fg",
              )}
            >
              {visibleCount}
            </span>
            <span className="text-[13px] text-court-fg-muted">
              {visibleCount === 1 ? "applicant" : "applicants"}
            </span>
          </div>
          <FilterChips
            tab={tab}
            onTab={setTab}
            counts={{ applied: applied.length, kept: kept.length }}
          />
        </div>

        {selectedKeys.size > 0 && (
          <div className="flex items-center justify-between rounded-2xl border-0 bg-court-accent-tint px-4 py-2.5 text-sm shadow-sm">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-court-brand-dark">
                {selectedKeys.size} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedKeys(new Set())}
                className="inline-flex items-center gap-1 text-[12px] text-court-fg-muted transition hover:text-court-fg"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            </div>
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={() => setBulkRejectOpen(true)}
              disabled={bulkBusy}
              className="h-8 rounded-full px-4 text-[12px]"
            >
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
              Reject {selectedKeys.size}
            </Button>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border-0 bg-court-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-court-surface-subtle">
                <tr>
                  <th scope="col" className="w-px px-3 py-3 text-center">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      aria-label="Select all rows on this tab"
                      checked={allSelected}
                      disabled={visibleKeys.length === 0}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </th>
                  <ColHeader label="Candidate" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                  <ColHeader label="Applied Role" active={sortKey === "job"} dir={sortDir} onClick={() => toggleSort("job")} />
                  <ColHeader
                    label={tab === "applied" ? "Applied" : "Kept Since"}
                    active={sortKey === "when"}
                    dir={sortDir}
                    onClick={() => toggleSort("when")}
                  />
                  {tab === "applied" && (
                    <ColHeader label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} />
                  )}
                  <th scope="col" className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-court-fg-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-court-border-soft">
                {tab === "applied" ? (
                  sortedApplied.length === 0 ? (
                    <EmptyRow label="No applicants in this view." colSpan={colSpan} />
                  ) : (
                    sortedApplied.map((r) => {
                      const key = rowKey(r);
                      return (
                        <AppliedRowView
                          key={key}
                          row={r}
                          selected={selectedKeys.has(key)}
                          onToggle={() => toggleRow(key)}
                        />
                      );
                    })
                  )
                ) : sortedKept.length === 0 ? (
                  <EmptyRow label="No kept candidates yet." colSpan={colSpan} />
                ) : (
                  sortedKept.map((r) => {
                    const key = rowKey(r);
                    return (
                      <KeptRowView
                        key={key}
                        row={r}
                        selected={selectedKeys.has(key)}
                        onToggle={() => toggleRow(key)}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        {bulkRejectOpen && (
          <RejectCandidateDialog
            candidateName={`${selectedKeys.size} candidate${selectedKeys.size === 1 ? "" : "s"}`}
            onClose={() => {
              if (!bulkBusy) setBulkRejectOpen(false);
            }}
            onConfirm={onBulkRejectConfirm}
          />
        )}
      </div>
    </div>
  );
}

// Spec rule 5 — Applied / Kept rendered as h-8 rounded-full pill
// filter chips with an accent-tint active state.
function FilterChips({
  tab,
  onTab,
  counts,
}: {
  tab: Tab;
  onTab: (next: Tab) => void;
  counts: { applied: number; kept: number };
}) {
  const items: ReadonlyArray<{ id: Tab; label: string; count: number }> = [
    { id: "applied", label: "Applied", count: counts.applied },
    { id: "kept", label: "Kept", count: counts.kept },
  ];
  return (
    <div
      role="tablist"
      aria-label="Applicant scope"
      className="inline-flex items-center gap-1.5"
    >
      {items.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(item.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition",
              active
                ? "bg-court-accent-tint text-court-brand-dark"
                : "bg-court-surface-subtle text-court-fg-muted hover:text-court-fg",
            )}
          >
            {item.label}
            <span
              className={cn(
                "tabular-nums",
                active ? "text-court-brand-dark/70" : "text-court-fg-muted/70",
              )}
            >
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-[13px] text-court-fg-muted">
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
    <th scope="col" className="px-5 py-3">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em]",
          active ? "text-court-fg" : "text-court-fg-muted hover:text-court-fg",
        )}
      >
        {label}
        {active && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

// Spec rule 4: action buttons rounded-full h-8 text-[12px] font-semibold
// routed through button.tsx. The Submit Link mirrors the same shape so
// the row reads as one button family.
const ACTION_SHAPE = "h-8 rounded-full px-3 text-[12px]";
const LINK_BUTTON_PRIMARY =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-court-brand bg-court-brand-tint px-3 text-[12px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-court-accent/50";

function AppliedRowView({
  row,
  selected,
  onToggle,
}: {
  row: AppliedRow;
  selected: boolean;
  onToggle: () => void;
}) {
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
    <tr className="transition hover:bg-court-surface-subtle/60">
      <td className="w-px px-3 py-3 align-middle text-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.candidateName}`}
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-brand"
        />
      </td>
      <td className="px-5 py-3 align-middle">
        <Link
          href={`/candidates/${row.candidateId}`}
          className="text-[13px] font-semibold text-court-fg hover:text-court-brand-dark"
        >
          {row.candidateName}
        </Link>
      </td>
      <td className="px-5 py-3 align-middle">
        <JobCell
          jobId={row.jobId}
          jobTitle={row.jobTitle}
          jobLocation={row.jobLocation}
          clientName={row.clientName}
        />
      </td>
      <td className="px-5 py-3 align-middle font-mono text-[11px] text-court-fg-muted">
        {formatDate(row.appliedAt)}
      </td>
      <td className="px-5 py-3 align-middle font-mono text-[11px] text-court-fg-muted">
        {formatSourceLabel(row.source)}
      </td>
      <td className="px-5 py-3 align-middle">
        <StatusChip status="new" />
      </td>
      <td className="px-5 py-3 align-middle">
        <div className="flex flex-nowrap items-center justify-end gap-1.5">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className={LINK_BUTTON_PRIMARY}
            title="Submit candidate"
          >
            <Send className="h-3 w-3" />
            <span className="hidden sm:inline">Submit</span>
          </Link>
          <Button
            type="button"
            variant="keep"
            size="sm"
            disabled={isPending}
            className={ACTION_SHAPE}
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
            <Bookmark className="h-3 w-3" />
            <span className="hidden sm:inline">Keep</span>
          </Button>
          <Button
            type="button"
            variant="reject"
            size="sm"
            disabled={isPending}
            className={ACTION_SHAPE}
            onClick={() => runAction(() => rejectOneApplicant(row, "applied"), "Rejected")}
          >
            <UserX className="h-3 w-3" />
            <span className="hidden sm:inline">Reject</span>
          </Button>
        </div>
      </td>
    </tr>
  );
}

function KeptRowView({
  row,
  selected,
  onToggle,
}: {
  row: KeptRow;
  selected: boolean;
  onToggle: () => void;
}) {
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
    <tr className="transition hover:bg-court-surface-subtle/60">
      <td className="w-px px-3 py-3 align-middle text-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.candidateName}`}
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-brand"
        />
      </td>
      <td className="px-5 py-3 align-middle">
        <Link
          href={`/candidates/${row.candidateId}`}
          className="text-[13px] font-semibold text-court-fg hover:text-court-brand-dark"
        >
          {row.candidateName}
        </Link>
      </td>
      <td className="px-5 py-3 align-middle">
        <JobCell
          jobId={row.jobId}
          jobTitle={row.jobTitle}
          jobLocation={row.jobLocation}
          clientName={row.clientName}
        />
      </td>
      <td className="px-5 py-3 align-middle font-mono text-[11px] text-court-fg-muted">
        {formatDate(row.keptAt)}
      </td>
      <td className="px-5 py-3 align-middle">
        <StatusChip status="reviewed" />
      </td>
      <td className="px-5 py-3 align-middle">
        <div className="flex flex-nowrap items-center justify-end gap-1.5">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className={LINK_BUTTON_PRIMARY}
            title="Submit candidate"
          >
            <Send className="h-3 w-3" />
            <span className="hidden sm:inline">Submit</span>
          </Link>
          <Button
            type="button"
            variant="reject"
            size="sm"
            disabled={isPending}
            className={ACTION_SHAPE}
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
            <UserX className="h-3 w-3" />
            <span className="hidden sm:inline">Remove</span>
          </Button>
        </div>
      </td>
    </tr>
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
