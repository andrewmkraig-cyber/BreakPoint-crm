"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Archive, ChevronDown, Globe2, Loader2, RefreshCw, Search, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import {
  runJobsBulkAction,
  setJobWebsitePriority,
  type JobsBulkAction,
} from "@/app/jobs/jobs-bulk-actions";
import { Button } from "@/components/ui/button";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { Pagination } from "@/components/pagination";
import { SortableHeader, type SortDirection } from "@/components/sortable-header";
import { cn } from "@/lib/utils";
import {
  DataTableBody,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { TabStrip } from "@/components/ui/tab-strip";

// Display-only: drop a trailing US zip (5-digit or ZIP+4) so the Location
// column reads "City, ST" instead of "City, ST 01760". Applied at render
// only — r.location keeps the full string so location search still matches
// on zip. If stripping leaves nothing (a bare-zip row like "41042"), the
// original is kept rather than rendering blank.
function cityStateOnly(loc: string): string {
  const out = loc.replace(/\s*,?\s*\d{5}(?:-\d{4})?\s*$/, "").trim();
  return out || loc;
}

export type JobLifecycle = "active" | "private" | "inactive";

export type OwnerScope = "mine" | "theirs" | "all";

export type JobRow = {
  id: number;
  jobCuid: string;
  // Stable URL segment for /jobs/[id] — cuid for Ace-native rows,
  // String(legacyRfId) for RF-imported rows. The synthetic negative
  // id used as the React key is never routable; using it as the link
  // target sends the page to 404 via the legacyRfId lookup path.
  slug: string;
  title: string;
  company: string;
  companyId: number | null;
  // True when the linked Client has a signed agreement on file (same
  // `isVerified` signal the /clients list uses). Surfaces as a small
  // shield next to the client name in the table so the recruiter can
  // tell at a glance which clients are under contract.
  clientIsVerified: boolean;
  location: string;
  compensation: string;
  websitePriority: number | null;
  publishedToWebsite: boolean;
  employmentType: string | null;
  jobType: string | null;
  statusName: string | null;
  isOpen: boolean;
  lifecycle: JobLifecycle;
  openings: number;
  lastEditedAt: string | null;
  createdAt: string | null;
  submittedCount: number;
  interviewingCount: number;
  hiredCount: number;
};

// Inline shield SVG — kept distinct from lucide ShieldCheck so the
// design crop matches the verified badge on /clients exactly (slightly
// thicker stroke). Copied verbatim from clients-view.tsx; sharing a
// component would be a future refactor.
function VerifiedShield() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

type JobsViewProps = {
  rows: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  tab: JobLifecycle;
  q: string;
  sort: string;
  dir: SortDirection;
  activeCount: number;
  privateCount: number;
  inactiveCount: number;
  priorityCount: number;
  owner: OwnerScope;
  otherUserName: string | null;
  error: string | null;
};

export function JobsView(props: JobsViewProps) {
  const { rows, total, page, pageSize, totalPages, tab, q, sort, dir, activeCount, privateCount, inactiveCount, priorityCount, owner, otherUserName, error } = props;
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(q);
  const [, startTransition] = useTransition();
  const [bulkPending, startBulkTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setQuery(q);
  }, [q]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [tab, q, page]);

  const allPageSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.jobCuid));

  function toggleRow(jobId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function runBulk(action: JobsBulkAction) {
    startBulkTransition(async () => {
      const result = await runJobsBulkAction({ jobIds: Array.from(selectedIds), action });
      if (!result.ok) {
        toast.error("Couldn't update selected jobs", { description: result.error });
        return;
      }
      toast.success(`${result.updated} job${result.updated === 1 ? "" : "s"} updated`);
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function changePriority(jobId: string, position: number) {
    startBulkTransition(async () => {
      const result = await setJobWebsitePriority({ jobId, position });
      if (!result.ok) {
        toast.error("Couldn't change priority", { description: result.error });
        return;
      }
      toast.success("Job priority updated");
      router.refresh();
    });
  }

  const buildParams = (overrides: Record<string, string | number | undefined>): URLSearchParams => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === "" || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    return next;
  };

  const buildHref = (overrides: Record<string, string | number | undefined>): string => {
    return `/jobs?${buildParams(overrides).toString()}`;
  };

  const buildSortHref = (key: string, nextDir: SortDirection): string =>
    buildHref({ sort: key, dir: nextDir, page: 1 });

  const buildPageHref = (p: number): string => buildHref({ page: p });

  function onSubmitSearch(e: FormEvent) {
    e.preventDefault();
    startTransition(() => {
      router.push(buildHref({ q: query, page: 1 }));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          tab={tab}
          activeCount={activeCount}
          privateCount={privateCount}
          inactiveCount={inactiveCount}
          buildHref={buildHref}
        />
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
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
        <div className={INPUT_FRAME_CLASS}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by job title, client, or location…"
            className={`${INPUT_CONTROL_CLASS} pl-10 pr-10 text-sm`}
          />
        </div>
      </form>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-court-brand/30 bg-court-brand/5 px-3 py-2">
          <span className="mr-1 text-xs font-semibold text-court-fg">
            {selectedIds.size} selected
          </span>
          {tab === "active" ? (
            <>
              <Button size="sm" variant="danger" disabled={bulkPending} onClick={() => runBulk("inactivate")}>
                {bulkPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                Inactivate
              </Button>
              <Button size="sm" disabled={bulkPending} onClick={() => runBulk("publish")}>
                <Globe2 className="h-3.5 w-3.5" /> Publish
              </Button>
              <Button size="sm" variant="secondary" disabled={bulkPending} onClick={() => runBulk("unpublish")}>
                <X className="h-3.5 w-3.5" /> Remove from website
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={bulkPending} onClick={() => runBulk("activate")}>
              {bulkPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Activate
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto shadow-none"
          >
            Clear
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load jobs.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-[22%]" />
              <col className="w-[20%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-20" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-16" />
            </colgroup>
            <DataTableHead>
              <tr className="bg-court-surface border-b border-court-border/60">
                <DataTableHeaderCell className="px-2">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={() =>
                      setSelectedIds(
                        allPageSelected ? new Set() : new Set(rows.map((row) => row.jobCuid)),
                      )
                    }
                    aria-label="Select all jobs on this page"
                    className="h-4 w-4 accent-court-brand"
                  />
                </DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Client" columnKey="client" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Job Title" columnKey="title" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Location" columnKey="location" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Compensation" columnKey="compensation" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell align="center"><SortableHeader label="Priority" columnKey="priority" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Last Edited" columnKey="lastEdited" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell align="right"><SortableHeader label="Submitted" columnKey="submitted" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
                <DataTableHeaderCell align="right"><SortableHeader label="Interviewing" columnKey="interviewing" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
                <DataTableHeaderCell align="right"><SortableHeader label="Hired" columnKey="hired" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.length === 0 && !error && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-court-fg-muted">
                    {tab === "active"
                      ? "No active jobs"
                      : tab === "private"
                        ? "No private jobs"
                        : "No inactive jobs"}
                    {q ? ` matching "${q}"` : ""}.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <DataTableRow
                  key={r.jobCuid}
                  className="group cursor-pointer"
                  onClick={() => router.push(`/jobs/${r.slug}`)}
                >
                  <td className="px-2 py-2 align-top" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.jobCuid)}
                      onChange={() => toggleRow(r.jobCuid)}
                      aria-label={`Select ${r.title}`}
                      className="h-4 w-4 accent-court-brand"
                    />
                  </td>
                  <td className="px-3 py-2 align-top font-medium text-court-fg">
                    {/* Whole row navigates to the job — the client name
                        cell intentionally has no separate <Link>, so a
                        click anywhere in the row (including this cell)
                        lands on /jobs/[id]. The /clients page keeps the
                        per-row client link for the client profile. */}
                    <span className="inline-flex items-center gap-1.5">
                      <span>{r.company || "—"}</span>
                      {r.clientIsVerified && (
                        <span
                          className="shrink-0 text-brand"
                          title="Signed fee agreement on file"
                        >
                          <VerifiedShield />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-court-fg">
                    <div className="font-medium">{r.title}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-court-fg-muted">
                    {r.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-court-fg-muted" />
                        {cityStateOnly(r.location)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-court-fg-muted">{r.compensation || "—"}</td>
                  <td className="px-2 py-1.5 text-center align-top" onClick={(event) => event.stopPropagation()}>
                    {tab === "active" ? (
                      <select
                        value={r.publishedToWebsite ? r.websitePriority ?? "" : ""}
                        onChange={(event) => {
                          if (event.target.value) {
                            changePriority(r.jobCuid, Number(event.target.value));
                          }
                        }}
                        disabled={bulkPending}
                        aria-label={`Priority for ${r.title}`}
                        className="h-7 w-14 rounded-md border border-court-border bg-court-surface px-1 text-center text-xs font-semibold text-court-fg outline-none focus:border-court-brand"
                      >
                        {!r.publishedToWebsite ? (
                          <option value="">N/A</option>
                        ) : (
                          <>
                            {r.websitePriority == null && <option value="">N/A</option>}
                            {Array.from({ length: priorityCount }, (_, index) => index + 1).map((position) => (
                              <option key={position} value={position}>{position}</option>
                            ))}
                          </>
                        )}
                      </select>
                    ) : (
                      <span className="text-court-fg-muted/60">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-court-fg-muted">
                    {r.lastEditedAt ? new Date(r.lastEditedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <CountPill value={r.submittedCount} />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <CountPill value={r.interviewingCount} />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <CountPill value={r.hiredCount} />
                  </td>
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
          buildHref={buildPageHref}
          label="jobs"
        />
      </div>
    </div>
  );
}

// Soft-green native dropdown matching the /clients OwnerScopeSelect
// styling (court-brand outline + faint tint + brand text). "Theirs" only
// renders when there is another user in the org. Navigates via the
// `owner` URL param so the server filter runs before pagination.
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
        aria-label="Filter jobs by owner"
        className="appearance-none rounded-md border border-court-brand/40 bg-court-brand/5 py-1 pl-3 pr-9 text-[13px] font-medium text-court-brand transition hover:bg-court-brand/10 focus:border-court-brand focus:outline-none focus:ring-2 focus:ring-court-brand/20"
      >
        <option value="mine">My Jobs</option>
        {otherFirst && <option value="theirs">{otherFirst}&apos;s Jobs</option>}
        <option value="all">All</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-brand" />
    </div>
  );
}

function Tabs({
  tab,
  activeCount,
  privateCount,
  inactiveCount,
  buildHref,
}: {
  tab: JobLifecycle;
  activeCount: number;
  privateCount: number;
  inactiveCount: number;
  buildHref: (overrides: Record<string, string | number | undefined>) => string;
}) {
  return (
    <TabStrip<JobLifecycle>
      ariaLabel="Job lifecycle"
      activeId={tab}
      items={[
        { id: "active", label: "Active", count: activeCount, href: buildHref({ tab: "active", page: 1 }) },
        { id: "private", label: "Private", count: privateCount, href: buildHref({ tab: "private", page: 1 }) },
        { id: "inactive", label: "Inactive", count: inactiveCount, href: buildHref({ tab: "inactive", page: 1 }) },
      ]}
    />
  );
}

function CountPill({ value }: { value: number }) {
  if (!value) return <span className="text-court-fg-muted/60">0</span>;
  // Andrew's call: submitted / interviewing / hired all read with the
  // same per-mode accent color so the row scans as a single pipeline
  // signal instead of three competing color codes.
  return (
    <span
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
        "bg-court-accent-tint text-court-accent-dark",
      )}
    >
      {value}
    </span>
  );
}
