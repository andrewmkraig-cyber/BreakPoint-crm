"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Bookmark, Loader2, Search } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { PIPELINE_LABELS } from "@/lib/recruiterflow";
import { StageBadge } from "@/components/stage-badge";
import { EmailLink } from "@/components/email-link";
import { cn, formatDate } from "@/lib/utils";

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

export type PipelineRow = {
  candidateId: number;
  candidateName: string;
  candidateTitle: string;
  jobId: number;
  jobTitle: string;
  clientName: string;
  stageName: string;
  bucket: Stage;
  lastActionAt: string | null;
  daysInStage: number | null;
  isKept: boolean;
  placement: PlacementDetails | null;
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
        className="flex flex-col gap-2 rounded-xl border border-border bg-white p-3 shadow-sm md:flex-row md:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by candidate, job, or client…"
            className="w-full rounded-lg border border-transparent bg-muted py-2 pl-10 pr-3 text-sm text-navy placeholder:text-muted-foreground focus:border-brand focus:bg-white focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load the pipeline.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Candidate</th>
                <th className="px-5 py-3 font-medium">Job</th>
                <th className="px-5 py-3 font-medium">Client</th>
                {stage === "pending_start" ? (
                  <>
                    <th className="px-5 py-3 font-medium">Start Date</th>
                    <th className="px-5 py-3 text-right font-medium">Days Until</th>
                    <th className="px-5 py-3 font-medium">Action</th>
                  </>
                ) : stage === "hired" ? (
                  <>
                    <th className="px-5 py-3 font-medium">Salary</th>
                    <th className="px-5 py-3 font-medium">Fee</th>
                    <th className="px-5 py-3 font-medium">Start Date</th>
                    <th className="px-5 py-3 font-medium">Billing Contact</th>
                    <th className="px-5 py-3 font-medium">Invoicing</th>
                  </>
                ) : (
                  <>
                    <th className="px-5 py-3 text-center font-medium">Stage</th>
                    <th className="px-5 py-3 font-medium">Last Action</th>
                    <th className="px-5 py-3 text-right font-medium">Days in Stage</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && !error && (
                <tr>
                  <td colSpan={stage === "hired" ? 8 : 6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No candidates in {PIPELINE_LABELS[stage]}
                    {q ? ` matching "${q}"` : ""}.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={`${r.candidateId}-${r.jobId}`}
                  className="cursor-pointer transition hover:bg-brand-tint/40"
                  onClick={() => router.push(`/candidates/${r.candidateId}`)}
                >
                  <td className="px-5 py-3 align-top">
                    <div className="flex items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-navy-400">
                        {initials(r.candidateName)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/candidates/${r.candidateId}`}
                          className="inline-flex items-center gap-1 font-medium text-navy hover:text-brand-dark"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.candidateName}
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
                          <div className="truncate text-xs text-muted-foreground">{r.candidateTitle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 align-top">
                    <Link
                      href={`/jobs/${r.jobId}`}
                      className="font-medium text-navy hover:text-brand-dark"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.jobTitle || "—"}
                    </Link>
                  </td>
                  <td className="px-5 py-3 align-top text-navy-400">{r.clientName || "—"}</td>

                  {stage === "pending_start" ? (
                    <PendingStartCells row={r} />
                  ) : stage === "hired" ? (
                    <HiredCells row={r} />
                  ) : (
                    <>
                      <td className="px-5 py-3 align-top text-center">
                        <StageChip stageName={r.stageName} bucket={r.bucket} placement={r.placement} />
                      </td>
                      <td className="px-5 py-3 align-top text-xs text-muted-foreground">
                        {formatDate(r.lastActionAt)}
                      </td>
                      <td className="px-5 py-3 align-top text-right">
                        {r.daysInStage == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
                              r.daysInStage >= 14
                                ? "bg-red-50 text-red-700"
                                : r.daysInStage >= 7
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-muted text-navy-400",
                            )}
                          >
                            {r.daysInStage}d
                          </span>
                        )}
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
      <td className="px-5 py-3 align-top text-sm text-navy">
        {startDate ? startDate.toLocaleDateString() : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-5 py-3 align-top text-right">
        {daysUntil == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              "inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
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
        <Link
          href={`/candidates/${row.candidateId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full bg-brand px-4 text-[10px] font-bold uppercase leading-none tracking-wide text-white shadow-sm transition hover:bg-brand-dark"
        >
          Confirm Start
        </Link>
      </td>
    </>
  );
}

function HiredCells({ row }: { row: PipelineRow }) {
  const p = row.placement;
  return (
    <>
      <td className="px-5 py-3 align-top text-sm text-navy">{formatMoney(p?.acceptedSalary ?? null, p?.acceptedCurrency)}</td>
      <td className="px-5 py-3 align-top text-sm text-navy">
        {formatMoney(p?.feeTotal ?? null, p?.acceptedCurrency)}
        {p?.feePercentage != null && (
          <span className="ml-1 text-[11px] text-muted-foreground">({p.feePercentage}%)</span>
        )}
      </td>
      <td className="px-5 py-3 align-top text-sm text-muted-foreground">
        {formatDate(p?.expectedStartDate)}
      </td>
      <td className="px-5 py-3 align-top text-xs">
        {p?.billingContactName ? (
          <div>
            <div className="text-navy">{p.billingContactName}</div>
            {p.billingContactEmail && (
              <span onClick={(e) => e.stopPropagation()}>
                <EmailLink
                  email={p.billingContactEmail}
                  className="text-brand-dark hover:underline"
                  mergeValues={{
                    candidateFirstName: (row.candidateName.split(/\s+/)[0] ?? "").trim(),
                    candidateFullName: row.candidateName,
                    clientContactFullName: p.billingContactName ?? "",
                    clientContactFirstName: (p.billingContactName?.split(/\s+/)[0] ?? "").trim(),
                    clientCompanyName: row.clientName,
                    jobTitle: row.jobTitle,
                  }}
                >
                  {p.billingContactEmail}
                </EmailLink>
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-5 py-3 align-top">
        {p?.invoicingFlagged ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            Flagged
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
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
    <div className="inline-flex flex-wrap rounded-lg border border-border bg-white p-1 shadow-sm">
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
        active ? "bg-brand-tint text-brand-dark" : "text-navy-400 hover:bg-muted",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          active ? "bg-brand text-white" : "bg-muted text-muted-foreground",
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
