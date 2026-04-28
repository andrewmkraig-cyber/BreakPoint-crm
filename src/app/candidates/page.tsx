import Link from "next/link";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CandidatesView } from "@/app/candidates/candidates-view";
import { getCandidatesPageForOrg, type CandidateListRow } from "@/lib/candidates";
import {
  listCandidateLists,
  type CandidateListSummary,
} from "@/app/candidates/lists-actions";
import {
  getOpenJobsForBulkPicker,
  type BulkPickerJob,
} from "@/app/candidates/bulk-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams?: { q?: string; page?: string; list?: string };
}) {
  const query = searchParams?.q ?? "";
  const listId = searchParams?.list ?? "";
  const page = parsePage(searchParams?.page);

  let candidates: CandidateListRow[] = [];
  let total = 0;
  let error: string | null = null;
  let lists: CandidateListSummary[] = [];
  let bulkJobs: BulkPickerJob[] = [];

  try {
    const [result, allLists, openJobs] = await Promise.all([
      getCandidatesPageForOrg({
        query,
        listId: listId || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
      listCandidateLists(),
      getOpenJobsForBulkPicker(),
    ]);
    candidates = result.rows;
    total = result.total;
    lists = allLists;
    bulkJobs = openJobs;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch candidates";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pool"
        title="Candidates"
        description="Sourced and applied candidates — not yet submitted. Full Boolean search is coming Day 5."
        actions={
          <Link
            href="/candidates/new"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-200"
          >
            <UserPlus className="h-3 w-3" /> Create New Candidate
          </Link>
        }
      />
      <CandidatesView
        initialQuery={query}
        candidates={candidates}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        error={error}
        lists={lists}
        selectedListId={listId}
        bulkJobs={bulkJobs}
      />
    </div>
  );
}
