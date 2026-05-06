"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Briefcase, Search, Loader2, MapPin } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { SortableHeader, type SortDirection } from "@/components/sortable-header";
import { cn } from "@/lib/utils";

export type JobRow = {
  id: number;
  title: string;
  company: string;
  companyId: number | null;
  location: string;
  compensation: string;
  employmentType: string | null;
  jobType: string | null;
  statusName: string | null;
  isOpen: boolean;
  openings: number;
  lastEditedAt: string | null;
  createdAt: string | null;
  submittedCount: number;
  interviewingCount: number;
  hiredCount: number;
};

type JobsViewProps = {
  rows: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  tab: "active" | "inactive";
  q: string;
  sort: string;
  dir: SortDirection;
  activeCount: number;
  inactiveCount: number;
  error: string | null;
};

export function JobsView(props: JobsViewProps) {
  const { rows, total, page, pageSize, totalPages, tab, q, sort, dir, activeCount, inactiveCount, error } = props;
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
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs tab={tab} activeCount={activeCount} inactiveCount={inactiveCount} buildHref={buildHref} />
        <Link
          href="/jobs/new"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-3 py-1.5 text-xs font-semibold text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
        >
          <Briefcase className="h-3 w-3" /> Post New Job
        </Link>
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

      <div className="overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-court-border bg-court-surface-subtle/60 text-[11px] uppercase tracking-wider text-court-fg-muted">
              <tr>
                <Th><SortableHeader label="Client" columnKey="client" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></Th>
                <Th><SortableHeader label="Job Title" columnKey="title" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></Th>
                <Th><SortableHeader label="Location" columnKey="location" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></Th>
                <Th><SortableHeader label="Compensation" columnKey="compensation" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></Th>
                <Th><SortableHeader label="Last Edited" columnKey="lastEdited" activeKey={sort} activeDir={dir} buildHref={buildSortHref} /></Th>
                <Th align="right"><SortableHeader label="Submitted" columnKey="submitted" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></Th>
                <Th align="right"><SortableHeader label="Interviewing" columnKey="interviewing" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></Th>
                <Th align="right"><SortableHeader label="Hired" columnKey="hired" activeKey={sort} activeDir={dir} buildHref={buildSortHref} align="right" /></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-court-border-soft">
              {rows.length === 0 && !error && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-court-fg-muted">
                    {tab === "active" ? "No active jobs" : "No inactive jobs"}
                    {q ? ` matching "${q}"` : ""}.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer transition hover:bg-court-accent-tint/50"
                  onClick={() => router.push(`/jobs/${r.id}`)}
                >
                  <td className="px-5 py-3 align-top font-medium text-court-fg">
                    <Link href={`/jobs/${r.id}`} className="hover:text-brand-dark" onClick={(e) => e.stopPropagation()}>
                      {r.company || "—"}
                    </Link>
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

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={cn("px-5 py-3 font-medium", align === "right" && "text-right")}>{children}</th>
  );
}

function Tabs({
  tab,
  activeCount,
  inactiveCount,
  buildHref,
}: {
  tab: "active" | "inactive";
  activeCount: number;
  inactiveCount: number;
  buildHref: (overrides: Record<string, string | number | undefined>) => string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-court-border bg-court-surface p-1 shadow-sm">
      <TabLink label="Active" count={activeCount} active={tab === "active"} href={buildHref({ tab: "active", page: 1 })} />
      <TabLink label="Inactive" count={inactiveCount} active={tab === "inactive"} href={buildHref({ tab: "inactive", page: 1 })} />
    </div>
  );
}

function TabLink({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-court-accent-tint text-court-accent-dark" : "text-court-fg-muted hover:bg-court-surface-subtle",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          active ? "bg-court-accent text-court-surface" : "bg-court-surface-subtle text-court-fg-muted",
        )}
      >
        {count.toLocaleString()}
      </span>
    </Link>
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
