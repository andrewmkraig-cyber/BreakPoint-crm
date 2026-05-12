import { JobsView, type JobLifecycle, type JobRow } from "@/app/jobs/jobs-view";
import {
  normalizeJob,
  buildJobCounts,
  emptyJobCounts,
} from "@/lib/rf-payload-shapes";
import {
  getRfCandidatesForOrg,
  getRfJobsForOrg,
  syntheticIdFromCuid,
} from "@/lib/candidates";
import { getClientsForOrg } from "@/lib/clients";

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
    tab?: JobLifecycle;
    sort?: string;
    dir?: "asc" | "desc";
    page?: string;
  };
}) {
  const rawTab = searchParams?.tab;
  const tab: JobLifecycle =
    rawTab === "private" || rawTab === "inactive" ? rawTab : "active";
  const q = (searchParams?.q ?? "").trim();
  const rawSort = (searchParams?.sort ?? "lastEdited") as SortKey;
  const sort: SortKey = (SORT_KEYS as string[]).includes(rawSort) ? rawSort : "lastEdited";
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";
  const pageParam = parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  let rows: JobRow[] = [];
  let activeCount = 0;
  let privateCount = 0;
  let inactiveCount = 0;
  let error: string | null = null;

  try {
    // Phase 2: Jobs list reads from Neon via the broadened shim —
    // includes both RF-imported and Ace-native Jobs in one iteration.
    const [jobs, candidates, clients] = await Promise.all([
      getRfJobsForOrg(),
      getRfCandidatesForOrg(),
      getClientsForOrg(),
    ]);
    const counts = buildJobCounts(candidates);
    // Map companyId (the numeric reference each JobRow already carries)
    // back to the client's verified flag. Two key paths so both RF-
    // imported and Ace-native clients land in the same map: RF rows key
    // on legacyRfId; Ace-native rows key on the synthetic djb2 of cuid
    // (same hash the jobs shim uses to mint a numeric companyId).
    const verifiedByCompanyId = new Map<number, boolean>();
    for (const c of clients) {
      if (c.legacyRfId != null) {
        verifiedByCompanyId.set(c.legacyRfId, c.isVerified);
      } else {
        verifiedByCompanyId.set(syntheticIdFromCuid(c.id), c.isVerified);
      }
    }
    const all: JobRow[] = jobs.map((raw) => {
      const j = normalizeJob(raw);
      const c = counts.get(j.id) ?? emptyJobCounts();
      // Lifecycle pulls from the shim's `_lifecycle` carry-along (set
      // straight from the Neon column); legacy rows that haven't been
      // touched since the migration fall back to the isOpen mapping.
      const rawLifecycle = (raw as { _lifecycle?: string | null })._lifecycle;
      const lifecycle: JobLifecycle =
        rawLifecycle === "private"
          ? "private"
          : rawLifecycle === "inactive"
            ? "inactive"
            : j.isOpen
              ? "active"
              : "inactive";
      // RF-imported rows route via the positive legacyRfId (j.id is the
      // real RF id). Ace-native rows have a synthetic negative id that
      // would 404 against /jobs/[id]; route via the cuid carried on
      // `_aceJobId` instead.
      const aceJobId = (raw as { _aceJobId?: string })._aceJobId;
      const slug = j.id < 0 && aceJobId ? aceJobId : String(j.id);
      return {
        ...j,
        slug,
        lifecycle,
        submittedCount: c.submitted,
        interviewingCount: c.interviewing,
        hiredCount: c.hired,
        clientIsVerified:
          j.companyId != null ? verifiedByCompanyId.get(j.companyId) ?? false : false,
      };
    });
    for (const r of all) {
      if (r.lifecycle === "active") activeCount++;
      else if (r.lifecycle === "private") privateCount++;
      else inactiveCount++;
    }
    rows = all.filter((r) => r.lifecycle === tab);

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
        privateCount={privateCount}
        inactiveCount={inactiveCount}
        error={error}
      />
    </div>
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
