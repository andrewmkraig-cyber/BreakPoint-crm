import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { JobsView, type JobRow } from "@/app/jobs/jobs-view";
import {
  normalizeJob,
  buildJobCounts,
  emptyJobCounts,
} from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg, getRfJobsForOrg } from "@/lib/candidates";

export const dynamic = "force-dynamic";

type SortKey =
  | "client"
  | "title"
  | "location"
  | "compensation"
  | "lastEdited"
  | "submitted"
  | "interviewing"
  | "hired";

const SORT_KEYS: SortKey[] = [
  "client",
  "title",
  "location",
  "compensation",
  "lastEdited",
  "submitted",
  "interviewing",
  "hired",
];

const PAGE_SIZE = 25;

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: {
    q?: string;
    tab?: "active" | "inactive";
    sort?: string;
    dir?: "asc" | "desc";
    page?: string;
  };
}) {
  const tab: "active" | "inactive" = searchParams?.tab === "inactive" ? "inactive" : "active";
  const q = (searchParams?.q ?? "").trim();
  const rawSort = (searchParams?.sort ?? "lastEdited") as SortKey;
  const sort: SortKey = (SORT_KEYS as string[]).includes(rawSort) ? rawSort : "lastEdited";
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";
  const pageParam = parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  let rows: JobRow[] = [];
  let activeCount = 0;
  let inactiveCount = 0;
  let error: string | null = null;

  try {
    // Phase 2: Jobs list reads from Neon via the broadened shim —
    // includes both RF-imported and Ace-native Jobs in one iteration.
    const [jobs, candidates] = await Promise.all([
      getRfJobsForOrg(),
      getRfCandidatesForOrg(),
    ]);
    const counts = buildJobCounts(candidates);
    const all: JobRow[] = jobs.map((raw) => {
      const j = normalizeJob(raw);
      const c = counts.get(j.id) ?? emptyJobCounts();
      return {
        ...j,
        submittedCount: c.submitted,
        interviewingCount: c.interviewing,
        hiredCount: c.hired,
      };
    });
    activeCount = all.filter((r) => r.isOpen).length;
    inactiveCount = all.length - activeCount;
    rows = all.filter((r) => (tab === "active" ? r.isOpen : !r.isOpen));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          r.company.toLowerCase().includes(needle) ||
          r.location.toLowerCase().includes(needle),
      );
    }

    rows.sort((a, b) => compareRow(a, b, sort, dir));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch jobs";
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        eyebrow="Requisitions"
        title="Jobs"
        description="Active and inactive requisitions. Counts come from each candidate's pipeline stage."
        actions={<JobsHeaderActions />}
      />
      <JobsView
        rows={pageRows}
        total={total}
        page={safePage}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        tab={tab}
        q={q}
        sort={sort}
        dir={dir}
        activeCount={activeCount}
        inactiveCount={inactiveCount}
        error={error}
      />
    </div>
  );
}

function JobsHeaderActions() {
  return (
    <Link
      href="/jobs/new"
      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
    >
      New Job in Ace
    </Link>
  );
}

function compareRow(a: JobRow, b: JobRow, key: SortKey, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  const v = (r: JobRow): string | number => {
    switch (key) {
      case "client":
        return r.company || "";
      case "title":
        return r.title || "";
      case "location":
        return r.location || "";
      case "compensation":
        return r.compensation || "";
      case "lastEdited":
        return r.lastEditedAt ? new Date(r.lastEditedAt).getTime() : 0;
      case "submitted":
        return r.submittedCount;
      case "interviewing":
        return r.interviewingCount;
      case "hired":
        return r.hiredCount;
    }
  };
  const va = v(a);
  const vb = v(b);
  if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * mul;
}
