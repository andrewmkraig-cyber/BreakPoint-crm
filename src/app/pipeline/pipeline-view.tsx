"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Bookmark, CalendarClock, DollarSign, Loader2, Search, UserX } from "lucide-react";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { PIPELINE_LABELS } from "@/lib/rf-payload-shapes";
import { StageBadge } from "@/components/stage-badge";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTableHead, DataTableHeaderCell } from "@/components/ui/data-table";
import { rejectLocalPlacement } from "@/app/candidates/[id]/local-placement-actions";
import { setCandidateNavList } from "@/lib/candidate-nav";
import { RejectCandidateDialog } from "@/components/reject-candidate-dialog";

type Stage = keyof typeof PIPELINE_LABELS;

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
  invoicingFlagged: boolean;
};

export type NextInterview = {
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
  error: string | null;
};

const STAGE_ORDER: Stage[] = ["submitted", "interviewing", "offer", "pending_start", "hired"];

export function PipelineView({ rows, total, page, totalPages, pageSize, stage, q, counts, error }: PipelineViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(q);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setQuery(q);
  }, [q]);

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
      </div>

      <form
        onSubmit={onSubmitSearch}
        className="flex flex-col gap-2 rounded-xl border border-court-border bg-court-surface p-3 shadow-sm md:flex-row md:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by candidate, job, or client…"
            // Same focus behaviour as the candidates list: input lifts from
            // surface-subtle (deeper) to surface on focus — mode-aware depth
            // change that still reads as "focused" in every palette.
            className="w-full rounded-lg border border-transparent bg-court-surface-subtle py-2 pl-10 pr-3 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:bg-court-surface focus:outline-none"
          />
        </div>
        <Button type="submit" size="md">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {/* Error panel keeps red semantics in every mode. */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load the pipeline.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <DataTableHead>
              <tr>
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
            <tbody className="divide-y divide-court-border-soft">
              {rows.length === 0 && !error && (
                <tr>
                  <td
                    colSpan={stage === "hired" ? 8 : stage === "pending_start" ? 6 : 7}
                    className="px-5 py-12 text-center text-sm text-court-fg-muted"
                  >
                    No candidates in {PIPELINE_LABELS[stage]}
                    {q ? ` matching "${q}"` : ""}.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={`${r.candidateId}-${r.jobId}`}
                  className="cursor-pointer transition hover:bg-court-accent-tint/40"
                  onClick={() => router.push(`/candidates/${r.candidateId}`)}
                >
                  <td className="px-5 py-3 align-top">
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
                              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800"
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
                  <td className="px-5 py-3 align-top">
                    <Link
                      href={`/jobs/${r.jobId}`}
                      className="font-medium text-court-fg hover:text-court-accent-dark"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.jobTitle || "—"}
                    </Link>
                    {r.bucket === "interviewing" && r.nextInterview && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-court-fg-muted">
                        <CalendarClock className="h-3 w-3" />
                        Next: {formatInterviewWhen(r.nextInterview.scheduledAt)} · {formatInterviewTypeShort(r.nextInterview.type)}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 align-top text-court-fg-muted">{r.clientName || "—"}</td>

                  {stage === "pending_start" ? (
                    <PendingStartCells row={r} />
                  ) : stage === "hired" ? (
                    <HiredCells row={r} />
                  ) : (
                    <>
                      <td className="px-5 py-3 align-top text-center">
                        <StageChip stageName={r.stageName} bucket={r.bucket} placement={r.placement} />
                      </td>
                      <td className="px-5 py-3 align-top text-center text-xs text-court-fg-muted">
                        {formatDate(r.lastActionAt)}
                      </td>
                      <td className="px-5 py-3 align-top text-center">
                        {r.daysInStage == null ? (
                          <span className="text-court-fg-muted">—</span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
                              // Red (≥14 days) and amber (≥7 days) pills are
                              // status semantics — kept fixed across all
                              // three modes. The "under 7 days" neutral pill
                              // tracks the theme.
                              r.daysInStage >= 14
                                ? "bg-red-50 text-red-700"
                                : r.daysInStage >= 7
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-court-surface-subtle text-court-fg-muted",
                            )}
                          >
                            {r.daysInStage}d
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 align-top">
                        {/* Schedule (submitted) + Offer (interviewing) sit
                            left of Reject. Both deep-link to the candidate
                            profile — the full modal flows live there. */}
                        <div className="flex items-center justify-end gap-1.5">
                          {r.bucket === "submitted" && (
                            <Link
                              href={`/candidates/${r.candidateId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
                              title="Schedule interview on candidate profile"
                            >
                              <CalendarClock className="h-3 w-3" /> Schedule
                            </Link>
                          )}
                          {r.bucket === "interviewing" && (
                            <Link
                              href={`/candidates/${r.candidateId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-purple-200 bg-purple-50 px-2.5 text-[11px] font-semibold text-purple-700 shadow-sm transition hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-950/60"
                              title="Record offer on candidate profile"
                            >
                              <DollarSign className="h-3 w-3" /> Offer
                            </Link>
                          )}
                          {(r.bucket === "submitted" || r.bucket === "interviewing") && r.placementId && (
                            <RejectButton placementId={r.placementId} candidateName={r.candidateName} />
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
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
      <td className="px-5 py-3 align-top text-center text-sm text-court-fg">
        {startDate ? startDate.toLocaleDateString() : <span className="text-court-fg-muted">—</span>}
      </td>
      <td className="px-5 py-3 align-top text-center">
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
                ? "bg-red-50 text-red-700"
                : soon
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700",
            )}
          >
            {overdue ? `${Math.abs(daysUntil)}d late` : daysUntil === 0 ? "Today" : `${daysUntil}d`}
          </span>
        )}
      </td>
      <td className="px-5 py-3 align-top">
        {/* Stack Confirm Start primary + Edit Placement secondary so both
            actions sit in the same cell without widening the column. The
            Edit Placement link deep-links via ?edit=placement&jobId=N —
            the candidate-profile handler reads that and auto-opens the
            PlacementDialog pre-filled for this (candidate, job). */}
        <div className="flex flex-col items-end gap-1.5">
          <Link
            href={`/candidates/${row.candidateId}?confirmStart=1&jobId=${row.jobId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 items-center justify-center whitespace-nowrap rounded-md border border-court-brand bg-court-brand-tint px-4 text-[10px] font-bold uppercase leading-none tracking-wide text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
          >
            Confirm Start
          </Link>
          <Link
            href={`/candidates/${row.candidateId}?edit=placement&jobId=${row.jobId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-6 items-center justify-center whitespace-nowrap rounded-md border border-court-border bg-court-surface px-4 text-[10px] font-bold uppercase leading-none tracking-wide text-court-fg-muted shadow-sm transition hover:border-court-accent/40 hover:text-court-fg"
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
      <td className="px-5 py-3 align-top text-center text-sm text-court-fg">{formatMoney(p?.acceptedSalary ?? null, p?.acceptedCurrency)}</td>
      <td className="px-5 py-3 align-top text-center text-sm text-court-fg">
        {formatMoney(p?.feeTotal ?? null, p?.acceptedCurrency)}
        {p?.feePercentage != null && (
          <span className="ml-1 text-[11px] text-court-fg-muted">({p.feePercentage}%)</span>
        )}
      </td>
      <td className="px-5 py-3 align-top text-center text-sm text-court-fg-muted">
        {formatDate(p?.expectedStartDate)}
      </td>
      <td className="px-5 py-3 align-top text-xs">
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
      <td className="px-5 py-3 align-top text-center">
        {/* Invoicing-flagged stays amber — status cue that should mean the
            same thing regardless of mode. */}
        {p?.invoicingFlagged ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            Flagged
          </span>
        ) : (
          <span className="text-court-fg-muted text-xs">—</span>
        )}
      </td>
    </>
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
    <div className="inline-flex flex-wrap rounded-lg border border-court-border bg-court-surface p-1 shadow-sm">
      {STAGE_ORDER.map((s) => (
        <StageTab
          key={s}
          label={PIPELINE_LABELS[s]}
          count={counts[s]}
          active={stage === s}
          href={buildHref({ stage: s, page: 1 })}
        />
      ))}
    </div>
  );
}

function StageTab({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-court-accent-tint text-court-accent-dark"
          : "text-court-fg-muted hover:bg-court-surface-subtle",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          // Active pill uses the same two-tone emerald shared across
          // the app's primary buttons; inactive pill tracks the
          // muted court palette.
          active
            ? "border border-court-brand bg-court-brand-tint text-court-brand-dark"
            : "bg-court-surface-subtle text-court-fg-muted",
        )}
      >
        {count.toLocaleString()}
      </span>
    </Link>
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
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 shadow-sm transition hover:bg-red-100 disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
        title="Reject this candidate for this job"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
        Reject
      </button>
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
