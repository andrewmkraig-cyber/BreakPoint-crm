"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Search, Loader2, MapPin } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { SortableHeader, type SortDirection } from "@/components/sortable-header";
import { cn } from "@/lib/utils";
import { DataTableHead, DataTableHeaderCell } from "@/components/ui/data-table";
import { TabStrip } from "@/components/ui/tab-strip";

export type JobLifecycle = "active" | "private" | "inactive";

export type JobRow = {
  id: number;
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
  error: string | null;
};

export function JobsView(props: JobsViewProps) {
  const { rows, total, page, pageSize, totalPages, tab, q, sort, dir, activeCount, privateCount, inactiveCount, error } = props;
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(q);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setQuery(q);
  }, [q]);

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
      <Tabs
        tab={tab}
        activeCount={activeCount}
        privateCount={privateCount}
        inactiveCount={inactiveCount}
        buildHref={buildHref}
      />

      <form
        onSubmit={onSubmitSearch}
        className="flex flex-col gap-2 rounded-xl border border-court-border/40 bg-court-surface p-3 shadow-sm md:flex-row md:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-court-fg-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by job title, client, or location…"
            className="w-full rounded-lg border border-transparent bg-court-surface-subtle py-2 pl-10 pr-3 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-brand focus:bg-court-surface focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-5 py-2 text-sm font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load jobs.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <DataTableHead>
              <tr>
                <DataTableHeaderCell><SortableHeader label="Client" columnKey="client" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Job Title" columnKey="title" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Location" columnKey="location" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Compensation" columnKey="compensation" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell><SortableHeader label="Last Edited" columnKey="lastEdited" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></DataTableHeaderCell>
                <DataTableHeaderCell align="right"><SortableHeader label="Submitted" columnKey="submitted" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
                <DataTableHeaderCell align="right"><SortableHeader label="Interviewing" columnKey="interviewing" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
                <DataTableHeaderCell align="right"><SortableHeader label="Hired" columnKey="hired" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {rows.length === 0 && !error && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-court-fg-muted">
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
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-court-border/40 transition hover:bg-court-surface-subtle"
                  onClick={() => router.push(`/jobs/${r.slug}`)}
                >
                  <td className="px-5 py-3 align-top font-medium text-court-fg">
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
                  <td className="px-5 py-3 align-top text-court-fg">
                    <div className="font-medium">{r.title}</div>
                  </td>
                  <td className="px-5 py-3 align-top text-court-fg-muted">
                    {r.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-court-fg-muted" />
                        {r.location}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 align-top text-court-fg-muted">{r.compensation || "—"}</td>
                  <td className="px-5 py-3 align-top text-court-fg-muted">
                    {r.lastEditedAt ? new Date(r.lastEditedAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-3 align-top text-right">
                    <CountPill value={r.submittedCount} />
                  </td>
                  <td className="px-5 py-3 align-top text-right">
                    <CountPill value={r.interviewingCount} />
                  </td>
                  <td className="px-5 py-3 align-top text-right">
                    <CountPill value={r.hiredCount} />
                  </td>
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
          buildHref={buildPageHref}
          label="jobs"
        />
      </div>
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
