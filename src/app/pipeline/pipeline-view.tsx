"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Bookmark, CalendarClock, ChevronDown, DollarSign, Handshake, Loader2, Search, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { PIPELINE_LABELS } from "@/lib/rf-payload-shapes";
import { StageBadge } from "@/components/stage-badge";
import { StageAgePill } from "@/components/ui/stage-age-pill";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DataTableBody,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { TabStrip } from "@/components/ui/tab-strip";
import { rejectLocalPlacement } from "@/app/candidates/[id]/local-placement-actions";
import { setCandidateNavList } from "@/lib/candidate-nav";
import { RejectCandidateDialog } from "@/components/reject-candidate-dialog";
import {
  PlacementEditDrawer,
  type PlacementDrawerContext,
} from "@/app/pipeline/placement-edit-drawer";

type Stage = keyof typeof PIPELINE_LABELS;

export type OwnerScope = "mine" | "theirs" | "all";

export type PlacementDetails = {
  id: string;
  stage: "offer" | "pending_start" | "hired";
  syncedToRf: boolean;
  acceptedSalary: number | null;
  acceptedCurrency: string | null;
  feePercentage: number | null;
  feeTotal: number | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  expectedStartDate: string | null;
  startConfirmedAt: string | null;
  invoiceStatus: "DRAFT" | "SENT" | "PAID" | null;
  // How the client paid this invoice. Set when the recruiter flips
  // the invoice to PAID; null on any pre-paid status. Surfaced as a
  // sub-label on the Invoicing pill so the desk can scan payment mix.
  invoicePaymentMethod: "CHECK" | "ACH" | "CREDIT" | null;
  placementNotes: string | null;
  candidateSource: string | null;
  cityOverride: string | null;
};

export type NextInterview = {
  id: string;
  scheduledAt: string;
  type: "phone_screen" | "video" | "in_person";
};

export type PipelineRow = {
  // Phase 4b: candidateId / jobId can be a legacy numeric RF id
  // (RF-imported rows) or a cuid (Ace-native rows). The /candidates/[id]
  // and /jobs/[id] routes resolve both shapes via their identifier-based
  // loaders so the Link hrefs work for either.
  candidateId: number | string;
  candidateName: string;
  candidateTitle: string;
  jobId: number | string;
  jobTitle: string;
  clientName: string;
  stageName: string;
  bucket: Stage;
  lastActionAt: string | null;
  daysInStage: number | null;
  isKept: boolean;
  // Neon Placement.id — present only for rows derived from a real
  // Placement row. RF-flat-pipeline rows (RFCandidate.jobs[] entries
  // with no Neon Placement) leave this null; the Reject button below
  // hides on those rows since there's no Placement to mutate.
  placementId: string | null;
  placement: PlacementDetails | null;
  nextInterview: NextInterview | null;
};

type PipelineViewProps = {
  rows: PipelineRow[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  stage: Stage;
  q: string;
  counts: Record<Stage, number>;
  owner: OwnerScope;
  otherUserName: string | null;
  error: string | null;
};

const STAGE_ORDER: Stage[] = ["submitted", "interviewing", "offer", "pending_start", "hired"];

// Stages where per-row Reject (and therefore bulk Reject) is offered.
// Pending Start + Hired have their own custom action cells and aren't
// in the rejection flow — those are "deal in flight / closed" states.
const REJECTABLE_STAGES: Stage[] = ["submitted", "interviewing", "offer"];

function isRejectableStage(s: Stage): boolean {
  return (REJECTABLE_STAGES as readonly Stage[]).includes(s);
}

// Soft-green native dropdown matching the /clients OwnerScopeSelect
// styling. "Theirs" only renders when there is another user in the org.
// Navigates via the `owner` URL param so the server filter runs before
// pagination.
function OwnerScopeSelect({
  scope,
  onChange,
  otherName,
}: {
  scope: OwnerScope;
  onChange: (s: OwnerScope) => void;
  otherName: string | null;
}) {
  const otherFirst = otherName?.trim().split(/\s+/)[0] ?? null;
  return (
    <div className="relative shrink-0">
      <select
        value={scope}
        onChange={(e) => onChange(e.target.value as OwnerScope)}
        aria-label="Filter pipeline by owner"
        className="appearance-none rounded-md border border-court-brand/40 bg-court-brand/5 py-1.5 pl-3 pr-9 text-sm font-medium text-court-brand transition hover:bg-court-brand/10 focus:border-court-brand focus:outline-none focus:ring-2 focus:ring-court-brand/20"
      >
        <option value="mine">My Pipeline</option>
        {otherFirst && <option value="theirs">{otherFirst}&apos;s Pipeline</option>}
        <option value="all">All</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-brand" />
    </div>
  );
}

export function PipelineView({ rows, total, page, totalPages, pageSize, stage, q, counts, owner, otherUserName, error }: PipelineViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(q);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setQuery(q);
  }, [q]);

  // Bulk selection — rejectable rows only. Stores Placement.id so the
  // bulk handler can call rejectLocalPlacement directly without
  // re-deriving the id from row keys. Cleared when the stage/search/
  // page slice changes so a stale selection can't bulk-reject the
  // wrong rows after navigation.
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Hired-stage rows open an inline edit drawer instead of routing to
  // the candidate profile — the drawer mutates the placement directly
  // (start date, salary, fees, notes) without leaving the pipeline.
  const [drawerCtx, setDrawerCtx] = useState<PlacementDrawerContext | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  function openPlacementDrawer(row: PipelineRow) {
    if (!row.placement || !row.placementId) return;
    setDrawerCtx({
      placementId: row.placementId,
      candidateName: row.candidateName,
      clientName: row.clientName,
      jobTitle: row.jobTitle,
      stage: row.placement.stage,
      stageLabel: row.stageName,
      expectedStartDate: row.placement.expectedStartDate,
      acceptedSalary: row.placement.acceptedSalary,
      feeTotal: row.placement.feeTotal,
      feePercentage: row.placement.feePercentage,
      placementNotes: row.placement.placementNotes,
      candidateSource: row.placement.candidateSource,
      cityOverride: row.placement.cityOverride,
    });
    setDrawerOpen(true);
  }
  useEffect(() => {
    setSelectedPlacementIds(new Set());
  }, [stage, q, page]);

  const showCheckboxCol = isRejectableStage(stage);
  const selectableRows = useMemo(
    () => rows.filter((r) => r.placementId !== null && isRejectableStage(r.bucket)),
    [rows],
  );
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((r) => selectedPlacementIds.has(r.placementId as string));
  const someSelected =
    selectedPlacementIds.size > 0 && !allSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleRow(placementId: string) {
    setSelectedPlacementIds((prev) => {
      const next = new Set(prev);
      if (next.has(placementId)) next.delete(placementId);
      else next.add(placementId);
      return next;
    });
  }
  function toggleAll() {
    setSelectedPlacementIds((prev) => {
      if (prev.size === selectableRows.length && selectableRows.length > 0) {
        return new Set();
      }
      return new Set(selectableRows.map((r) => r.placementId as string));
    });
  }

  async function onBulkRejectConfirm({ sendRejectionEmail }: { sendRejectionEmail: boolean }) {
    const ids = Array.from(selectedPlacementIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    // Sequential with a small gap — Gmail rate-limits when the
    // rejection-email checkbox fires for every row, and Neon's pool
    // is friendlier under serial writes than a thundering herd.
    for (const id of ids) {
      try {
        const res = await rejectLocalPlacement({ placementId: id, sendRejectionEmail });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setBulkRejectOpen(false);
    setSelectedPlacementIds(new Set());
    if (fail === 0) {
      toast.success(
        sendRejectionEmail
          ? `Rejected ${ok} — emails sent`
          : `Rejected ${ok}`,
      );
    } else if (ok === 0) {
      toast.error(`Couldn't reject (${fail} failed)`);
    } else {
      toast.warning(`Rejected ${ok}, ${fail} failed`);
    }
    router.refresh();
  }

  // Stash the visible row ids so the candidate profile's Prev/Next
  // nav can walk through this exact stage's slice in the user's
  // current sort/filter order. Re-runs whenever the rendered rows
  // change (page, stage, search). String() coerces both numeric
  // RF ids and cuids into the routing form /candidates/[id] expects.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params2 = new URLSearchParams(params?.toString() ?? "");
    const qs = params2.toString();
    setCandidateNavList({
      source: "pipeline",
      backHref: qs ? `/pipeline?${qs}` : "/pipeline",
      ids: rows.map((r) => String(r.candidateId)),
    });
  }, [rows, params]);

  const buildHref = (overrides: Record<string, string | number | undefined>): string => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "" || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    return `/pipeline?${next.toString()}`;
  };

  function onSubmitSearch(e: FormEvent) {
    e.preventDefault();
    startTransition(() => {
      router.push(buildHref({ q: query, page: 1 }));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center">
        <StageTabs stage={stage} counts={counts} buildHref={buildHref} />
        <div className="md:ml-auto">
          <OwnerScopeSelect
            scope={owner}
            otherName={otherUserName}
            onChange={(s) => {
              startTransition(() => {
                router.push(buildHref({ owner: s, page: 1 }));
              });
            }}
          />
        </div>
      </div>

      {/* Clients-style search: clean rounded input, icon inside, no green
          fill or submit button. Enter submits the form, which runs the
          existing server-side `?q=` search. */}
      <form onSubmit={onSubmitSearch} className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-court-fg-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by candidate, job, or client…"
          className="w-full rounded-full border border-court-border bg-court-surface py-1.5 pl-10 pr-4 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </form>

      {/* Error panel keeps red semantics in every mode. */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load the pipeline.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      {showCheckboxCol && selectedPlacementIds.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-court-accent/40 bg-court-accent-tint px-4 py-2 text-sm shadow-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-court-fg">
              {selectedPlacementIds.size} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedPlacementIds(new Set())}
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
              Reject {selectedPlacementIds.size}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <DataTableHead>
              <tr className="bg-court-surface border-b border-court-border/60">
                {showCheckboxCol && (
                  <DataTableHeaderCell align="center">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      aria-label="Select all rejectable rows on this page"
                      checked={allSelected}
                      disabled={selectableRows.length === 0}
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </DataTableHeaderCell>
                )}
                <DataTableHeaderCell>Candidate</DataTableHeaderCell>
                <DataTableHeaderCell>Job</DataTableHeaderCell>
                <DataTableHeaderCell>Client</DataTableHeaderCell>
                {stage === "pending_start" ? (
                  <>
                    <DataTableHeaderCell align="center">Start Date</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">Days Until</DataTableHeaderCell>
                    <DataTableHeaderCell align="right">Action</DataTableHeaderCell>
                  </>
                ) : stage === "hired" ? (
                  <>
                    <DataTableHeaderCell align="center">Salary</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">Fee</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">Start Date</DataTableHeaderCell>
                    <DataTableHeaderCell>Billing Contact</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">Invoicing</DataTableHeaderCell>
                  </>
                ) : (
                  <>
                    <DataTableHeaderCell align="center">Stage</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">Last Action</DataTableHeaderCell>
                    <DataTableHeaderCell align="center">Days in Stage</DataTableHeaderCell>
                    <DataTableHeaderCell align="right" />
                  </>
                )}
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.length === 0 && !error && (
                <tr>
                  <td
                    colSpan={
                      (stage === "hired" ? 8 : stage === "pending_start" ? 6 : 7) +
                      (showCheckboxCol ? 1 : 0)
                    }
                    className="px-4 py-12 text-center text-sm text-court-fg-muted"
                  >
                    No candidates in {PIPELINE_LABELS[stage]}
                    {q ? ` matching "${q}"` : ""}.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <DataTableRow
                  key={`${r.candidateId}-${r.jobId}`}
                  className="cursor-pointer"
                  onClick={() => {
                    // Hired-stage rows open the inline edit drawer; every
                    // other stage keeps the existing candidate-profile
                    // jump (action buttons / links inside the row already
                    // stopPropagation, so their behaviour is unchanged).
                    if (r.bucket === "hired" && r.placement && r.placementId) {
                      openPlacementDrawer(r);
                      return;
                    }
                    router.push(`/candidates/${r.candidateId}`);
                  }}
                >
                  {showCheckboxCol && (
                    <td
                      className="w-px px-3 py-3 align-top text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.placementId && isRejectableStage(r.bucket) ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.candidateName}`}
                          checked={selectedPlacementIds.has(r.placementId)}
                          onChange={() => toggleRow(r.placementId as string)}
                          className="h-3.5 w-3.5 cursor-pointer accent-brand"
                        />
                      ) : null}
                    </td>
                  )}
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-court-surface-subtle text-[11px] font-semibold text-court-fg-muted">
                        {initials(r.candidateName)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/candidates/${r.candidateId}`}
                          className="inline-flex items-center gap-1 font-medium text-court-fg hover:text-court-accent-dark"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.candidateName}
                          {/* Kept badge keeps amber semantics across modes —
                              a status cue should read the same regardless of
                              palette. */}
                          {r.isKept && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                              title="Kept candidate"
                            >
                              <Bookmark className="h-2.5 w-2.5" /> Kept
                            </span>
                          )}
                        </Link>
                        {r.candidateTitle && (
                          <div className="truncate text-xs text-court-fg-muted">{r.candidateTitle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/jobs/${r.jobId}`}
                      className="text-[13px] font-normal text-court-fg hover:text-court-accent-dark"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.jobTitle || "—"}
                    </Link>
                    {r.bucket === "interviewing" && r.nextInterview && (
                      <Link
                        href={`/candidates/${r.candidateId}?edit=interview&interviewId=${encodeURIComponent(r.nextInterview.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        title="Edit interview"
                        aria-label="Edit interview"
                        className="mt-0.5 inline-flex items-center gap-1 rounded text-[11px] text-court-fg-muted underline-offset-2 transition hover:text-court-fg hover:underline"
                      >
                        <CalendarClock className="h-3 w-3" />
                        Next: {formatInterviewWhen(r.nextInterview.scheduledAt)} · {formatInterviewTypeShort(r.nextInterview.type)}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-court-fg-muted">{r.clientName || "—"}</td>

                  {stage === "pending_start" ? (
                    <PendingStartCells row={r} />
                  ) : stage === "hired" ? (
                    <HiredCells row={r} />
                  ) : (
                    <>
                      <td className="px-4 py-3 align-top text-center">
                        <StageChip stageName={r.stageName} bucket={r.bucket} placement={r.placement} />
                      </td>
                      <td className="px-4 py-3 align-top text-center text-xs text-court-fg-muted">
                        {formatDate(r.lastActionAt)}
                      </td>
                      <td className="px-4 py-3 align-top text-center">
                        <StageAgePill value={r.daysInStage} />
                      </td>
                      <td className="w-px whitespace-nowrap px-4 py-3 align-top">
                        {/* Schedule (submitted) + Offer (interviewing) sit
                            left of Reject. Both deep-link to the candidate
                            profile — the full modal flows live there.
                            Labels collapse to icon-only below md so the
                            action column stays visible when the page
                            decompresses; w-px + whitespace-nowrap on the
                            cell pins it to its natural width and forces
                            other columns (Job/Client) to compress first. */}
                        <div className="flex items-center justify-end gap-1.5">
                          {r.bucket === "submitted" && (
                            // Anchor-shaped twin of <Button variant="schedule">.
                            // Token classes mirror the variant so the Schedule
                            // link reads identically to other calendar actions
                            // (e.g. Schedule Interview on the candidate
                            // profile) without nesting a <button> in a Link.
                            <Link
                              href={`/candidates/${r.candidateId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
                              title="Schedule interview on candidate profile"
                              aria-label="Schedule interview"
                            >
                              <CalendarClock className="h-3 w-3" />
                              <span className="hidden md:inline">Schedule</span>
                            </Link>
                          )}
                          {r.bucket === "interviewing" && (
                            <Link
                              href={`/candidates/${r.candidateId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-purple-200 bg-purple-50 px-2.5 text-[11px] font-semibold text-purple-700 shadow-sm transition hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-950/60"
                              title="Record offer on candidate profile"
                              aria-label="Record offer"
                            >
                              <DollarSign className="h-3 w-3" />
                              <span className="hidden md:inline">Offer</span>
                            </Link>
                          )}
                          {r.bucket === "offer" && (
                            // Green Placement link mirroring the
                            // candidate-profile Placement button.
                            // ?edit=placement&jobId=NN auto-opens the
                            // PlacementDialog when jobId is the RF
                            // numeric — Ace-native cuid rows just land
                            // on the profile (still the same modal,
                            // one extra click). The candidate page
                            // strips the params after firing so
                            // refreshes don't re-open the modal.
                            <Link
                              href={`/candidates/${r.candidateId}?edit=placement&jobId=${r.jobId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-court-brand bg-court-brand-tint px-2.5 text-[11px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
                              title="Record placement"
                              aria-label="Record placement"
                            >
                              <Handshake className="h-3 w-3" />
                              <span className="hidden md:inline">Placement</span>
                            </Link>
                          )}
                          {(r.bucket === "submitted" ||
                            r.bucket === "interviewing" ||
                            r.bucket === "offer") &&
                            r.placementId && (
                              <RejectButton placementId={r.placementId} candidateName={r.candidateName} />
                            )}
                        </div>
                      </td>
                    </>
                  )}
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          buildHref={(p) => buildHref({ page: p })}
          label="submittals"
        />
      </div>
      {bulkRejectOpen && (
        <RejectCandidateDialog
          candidateName={`${selectedPlacementIds.size} candidate${selectedPlacementIds.size === 1 ? "" : "s"}`}
          onClose={() => {
            if (!bulkBusy) setBulkRejectOpen(false);
          }}
          onConfirm={onBulkRejectConfirm}
        />
      )}
      <PlacementEditDrawer
        open={drawerOpen}
        context={drawerCtx}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function PendingStartCells({ row }: { row: PipelineRow }) {
  const p = row.placement;
  const startDate = p?.expectedStartDate ? new Date(p.expectedStartDate) : null;
  const daysUntil = startDate ? Math.ceil((startDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const overdue = daysUntil != null && daysUntil < 0;
  const soon = daysUntil != null && daysUntil >= 0 && daysUntil <= 7;
  return (
    <>
      <td className="px-4 py-3 align-top text-center text-sm text-court-fg">
        {startDate ? startDate.toLocaleDateString() : <span className="text-court-fg-muted">—</span>}
      </td>
      <td className="px-4 py-3 align-top text-center">
        {daysUntil == null ? (
          <span className="text-court-fg-muted">—</span>
        ) : (
          <span
            className={cn(
              "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
              // Red/amber/emerald "days until start" pills stay on their
              // semantic palette in every mode — overdue always reads red,
              // soon always reads amber, on-track always reads green.
              overdue
                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200"
                : soon
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
            )}
          >
            {overdue ? `${Math.abs(daysUntil)}d late` : daysUntil === 0 ? "Today" : `${daysUntil}d`}
          </span>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-row items-center justify-end gap-2">
          <Link
            href={`/candidates/${row.candidateId}?confirmStart=1&jobId=${row.jobId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-court-brand bg-court-brand-tint px-4 text-[12px] font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
          >
            Confirm Start
          </Link>
          <Link
            href={`/candidates/${row.candidateId}?edit=placement&jobId=${row.jobId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-court-border bg-court-surface px-4 text-[12px] font-semibold text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg"
          >
            Edit Placement
          </Link>
        </div>
      </td>
    </>
  );
}

function HiredCells({ row }: { row: PipelineRow }) {
  const p = row.placement;
  return (
    <>
      <td className="px-4 py-3 align-top text-center text-sm text-court-fg">{formatMoney(p?.acceptedSalary ?? null, p?.acceptedCurrency)}</td>
      <td className="px-4 py-3 align-top text-center text-sm text-court-fg">
        {formatMoney(p?.feeTotal ?? null, p?.acceptedCurrency)}
        {p?.feePercentage != null && (
          <span className="ml-1 text-[11px] text-court-fg-muted">({p.feePercentage}%)</span>
        )}
      </td>
      <td className="px-4 py-3 align-top text-center text-sm text-court-fg-muted">
        {formatDate(p?.expectedStartDate)}
      </td>
      <td className="px-4 py-3 align-top text-xs">
        {p?.billingContactName ? (
          <div>
            <div className="text-court-fg">{p.billingContactName}</div>
            {p.billingContactEmail && (
              <span onClick={(e) => e.stopPropagation()}>
                <EmailPopupLauncher
                  email={p.billingContactEmail}
                  className="text-court-accent-dark hover:underline"
                  context={{
                    candidate: {
                      firstName: (row.candidateName.split(/\s+/)[0] ?? "").trim(),
                    },
                    client: {
                      name: row.clientName,
                      primaryContactFirstName:
                        (p.billingContactName?.split(/\s+/)[0] ?? "").trim(),
                    },
                    job: { title: row.jobTitle },
                  }}
                >
                  {p.billingContactEmail}
                </EmailPopupLauncher>
              </span>
            )}
          </div>
        ) : (
          <span className="text-court-fg-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3 align-top text-center">
        <div className="flex flex-col items-center gap-0.5">
          <InvoiceStatusPill status={p?.invoiceStatus ?? null} />
          {p?.invoicePaymentMethod ? (
            <span className="text-[10px] font-medium uppercase tracking-wider text-court-fg-muted">
              {paymentMethodLabel(p.invoicePaymentMethod)}
            </span>
          ) : null}
        </div>
      </td>
    </>
  );
}

function paymentMethodLabel(method: "CHECK" | "ACH" | "CREDIT"): string {
  if (method === "CHECK") return "Check";
  if (method === "ACH") return "ACH";
  return "Credit";
}

function InvoiceStatusPill({ status }: { status: "DRAFT" | "SENT" | "PAID" | null }) {
  // Invoice lifecycle pill — colors track the status meaning across all
  // three Court modes (paid=green, sent=blue, draft=amber, missing=muted).
  if (status === "PAID") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
        Paid
      </span>
    );
  }
  if (status === "SENT") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
        Sent
      </span>
    );
  }
  if (status === "DRAFT") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-court-fg-muted">
      No invoice
    </span>
  );
}

function formatMoney(n: number | null, currency: string | null | undefined): string {
  if (!n) return "—";
  const sym = (currency ?? "USD").toUpperCase() === "USD" ? "$" : `${(currency ?? "USD").toUpperCase()} `;
  return `${sym}${n.toLocaleString()}`;
}

function StageTabs({
  stage,
  counts,
  buildHref,
}: {
  stage: Stage;
  counts: Record<Stage, number>;
  buildHref: (overrides: Record<string, string | number | undefined>) => string;
}) {
  return (
    <TabStrip<Stage>
      ariaLabel="Pipeline stage"
      activeId={stage}
      items={STAGE_ORDER.map((s) => ({
        id: s,
        label: PIPELINE_LABELS[s],
        count: counts[s],
        href: buildHref({ stage: s, page: 1 }),
      }))}
    />
  );
}

function StageChip({
  stageName,
  bucket,
}: {
  stageName: string;
  bucket: Stage;
  placement?: PlacementDetails | null;
}) {
  return <StageBadge bucket={bucket} label={stageName || PIPELINE_LABELS[bucket]} />;
}

// Inline Reject button for the per-row Action cell. stopPropagation on
// click so the row's outer onClick (navigate to candidate profile) doesn't
// also fire. Calls the placementId-keyed action so it works for both
// RF-imported and Ace-native rows.
function RejectButton({ placementId, candidateName }: { placementId: string; candidateName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(true);
  }

  async function onConfirm({ sendRejectionEmail }: { sendRejectionEmail: boolean }) {
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await rejectLocalPlacement({ placementId, sendRejectionEmail });
        if (!res.ok) {
          toast.error("Couldn't reject", { description: res.error });
          resolve();
          return;
        }
        toast.success(sendRejectionEmail ? "Rejected — email sent" : "Rejected");
        setOpen(false);
        router.refresh();
        resolve();
      });
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="reject"
        size="sm"
        onClick={onClick}
        disabled={isPending}
        title="Reject this candidate for this job"
        aria-label="Reject"
        className="h-7 whitespace-nowrap px-2.5 text-[11px]"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
        <span className="hidden md:inline">Reject</span>
      </Button>
      {open && (
        <RejectCandidateDialog
          candidateName={candidateName}
          onClose={() => {
            if (!isPending) setOpen(false);
          }}
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}

function formatInterviewWhen(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInterviewTypeShort(t: NextInterview["type"]): string {
  if (t === "phone_screen") return "Phone";
  if (t === "video") return "Video";
  return "Onsite";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
