"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Bookmark, ChevronDown, ChevronUp, Loader2, Send, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DataTableBody,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { TabStrip } from "@/components/ui/tab-strip";
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

function rowKey(r: { candidateId: number | string; jobId: number | string }): string {
  return `${r.candidateId}-${r.jobId}`;
}

// Single source of truth for dispatching a per-row reject — used by
// both the row-level Reject button (Applied tab) and the bulk handler.
// Returns the action result so callers can tally ok/fail counts.
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

  // Bulk selection — keyed by `${candidateId}-${jobId}` (same key as
  // the table row). Selection clears on tab switch so a stale set
  // can't bulk-reject rows the recruiter can no longer see.
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
    // Applicant-tab reject actions don't yet support a send-email
    // toggle (only the placement-id-keyed pipeline reject does), so
    // the dialog's checkbox is informational here. Underscored param
    // documents the intentional drop.
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

  // Stash the active tab's row ids (in current sort order) so the
  // candidate profile's Prev/Next nav can walk them. Re-runs when the
  // tab flips or the sort changes — the nav follows whichever slice
  // the recruiter is actually staring at.
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

  const colSpan = tab === "applied" ? 6 : 5;

  return (
    <div className="space-y-4">
      <TabStrip<Tab>
        ariaLabel="Applicant scope"
        activeId={tab}
        onChange={setTab}
        items={[
          { id: "applied", label: "Applied", count: applied.length },
          { id: "kept", label: "Kept", count: kept.length },
        ]}
      />

      {selectedKeys.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-court-accent/40 bg-court-accent-tint px-4 py-2 text-sm shadow-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-court-fg">
              {selectedKeys.size} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set())}
              className="inline-flex items-center gap-1 text-xs text-court-fg-muted transition hover:text-court-fg"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="reject"
              size="sm"
              onClick={() => setBulkRejectOpen(true)}
              disabled={bulkBusy}
              className="h-7 px-3 text-[11px]"
            >
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
              Reject {selectedKeys.size}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell align="center">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    aria-label="Select all rows on this tab"
                    checked={allSelected}
                    disabled={visibleKeys.length === 0}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </DataTableHeaderCell>
                <ColHeader label="Candidate" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <ColHeader label="Job" active={sortKey === "job"} dir={sortDir} onClick={() => toggleSort("job")} />
                <ColHeader
                  label={tab === "applied" ? "Date Applied" : "Kept Since"}
                  active={sortKey === "when"}
                  dir={sortDir}
                  onClick={() => toggleSort("when")}
                  align="center"
                />
                {tab === "applied" && (
                  <ColHeader label="Source" active={sortKey === "source"} dir={sortDir} onClick={() => toggleSort("source")} align="center" />
                )}
                <DataTableHeaderCell align="right">Actions</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <DataTableBody>
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
            </DataTableBody>
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
  );
}

function EmptyRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center text-sm text-court-fg-muted">
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
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "center" | "right";
}) {
  return (
    <DataTableHeaderCell align={align}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide",
          active ? "text-court-fg" : "text-court-fg-muted hover:text-court-fg",
        )}
      >
        {label}
        {active && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </DataTableHeaderCell>
  );
}

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
    <DataTableRow>
      <td className="w-px px-3 py-3 align-top text-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.candidateName}`}
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-brand"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <Link href={`/candidates/${row.candidateId}`} className="font-medium text-court-fg hover:text-court-accent-dark">
          {row.candidateName}
        </Link>
      </td>
      <td className="px-4 py-3 align-top">
        <JobCell
          jobId={row.jobId}
          jobTitle={row.jobTitle}
          jobLocation={row.jobLocation}
          clientName={row.clientName}
        />
      </td>
      <td className="px-4 py-3 align-top text-center text-xs text-court-fg-muted">{formatDate(row.appliedAt)}</td>
      <td className="px-4 py-3 align-top text-center text-sm text-court-fg-muted">{formatSourceLabel(row.source)}</td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-row flex-nowrap items-center justify-end gap-2">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          {/* Submit / Keep / Reject share the row-action chip style
              (rounded-md, tinted bg with proper dark variants, label
              hidden below sm so the three buttons never wrap into an
              ugly stack on narrow viewports). Submit is a Link because
              it deep-links to the candidate profile's submittal
              composer; the actual stage move to "submitted" happens
              when the recruiter hits Send in the composer. */}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className={ROW_ACTION_CLASS.primary}
            title="Submit candidate"
          >
            <Send className="h-3 w-3" />
            <span className="hidden sm:inline">Submit</span>
          </Link>
          {/* Phase 4b: Keep / Reject fire inline regardless of job
              identity shape. The server actions accept either a numeric
              jobRfId (RF-imported) or a cuid jobId (Ace-native); clients
              pick the right field here. */}
          <RowActionButton
            tone="keep"
            label="Keep"
            icon={<Bookmark className="h-3 w-3" />}
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
          />
          <RowActionButton
            tone="reject"
            label="Reject"
            icon={<UserX className="h-3 w-3" />}
            disabled={isPending}
            onClick={() => runAction(() => rejectOneApplicant(row, "applied"), "Rejected")}
          />
        </div>
      </td>
    </DataTableRow>
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
    <DataTableRow>
      <td className="w-px px-3 py-3 align-top text-center">
        <input
          type="checkbox"
          aria-label={`Select ${row.candidateName}`}
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 cursor-pointer accent-brand"
        />
      </td>
      <td className="px-4 py-3 align-top">
        <Link href={`/candidates/${row.candidateId}`} className="font-medium text-court-fg hover:text-court-accent-dark">
          {row.candidateName}
        </Link>
      </td>
      <td className="px-4 py-3 align-top">
        <JobCell
          jobId={row.jobId}
          jobTitle={row.jobTitle}
          jobLocation={row.jobLocation}
          clientName={row.clientName}
        />
      </td>
      <td className="px-4 py-3 align-top text-center text-xs text-court-fg-muted">{formatDate(row.keptAt)}</td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-row flex-nowrap items-center justify-end gap-2">
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-court-fg-muted" />}
          {/* Submit / Remove share the row-action chip style — same
              tinted rounded-md treatment as the Applied tab so the two
              tabs read as a matched pair. Submit deep-links to the
              candidate profile's submittal composer; the placement
              transitions to "submitted" when the recruiter hits Send. */}
          <Link
            href={`/candidates/${row.candidateId}?compose=submittal&jobId=${row.jobId}`}
            className={ROW_ACTION_CLASS.primary}
            title="Submit candidate"
          >
            <Send className="h-3 w-3" />
            <span className="hidden sm:inline">Submit</span>
          </Link>
          <RowActionButton
            tone="reject"
            label="Remove"
            icon={<UserX className="h-3 w-3" />}
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
          />
        </div>
      </td>
    </DataTableRow>
  );
}

// Shared row-action chip styles. All three tones (primary/keep/reject)
// share the same shape, padding, and font so Submit/Keep/Reject read
// as one button family. Each tone carries its own light + dark
// palette — the dark variants drop the saturated bg-X-50 tiles down
// to bg-X-950/40 so they don't pop on a dark page. Submit uses court-
// brand tokens because primary action color follows whichever Court
// Mode is active.
const ROW_ACTION_BASE =
  "inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-[11px] font-semibold shadow-sm transition disabled:opacity-60";

// Token-aligned twins of Button "primary" / "keep" / "reject" variants
// so the row-action chips read identically to the shared <Button>
// primitive without forcing every row into the larger <Button> sizing.
const ROW_ACTION_CLASS = {
  primary: cn(
    ROW_ACTION_BASE,
    "border-court-brand bg-court-brand-tint text-court-brand-dark hover:bg-court-brand/25",
  ),
  keep: cn(
    ROW_ACTION_BASE,
    "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60",
  ),
  reject: cn(
    ROW_ACTION_BASE,
    "border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60",
  ),
};

function RowActionButton({
  tone,
  label,
  icon,
  onClick,
  disabled,
}: {
  tone: "primary" | "keep" | "reject";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={ROW_ACTION_CLASS[tone]}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
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
