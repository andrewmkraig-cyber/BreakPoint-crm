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
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { resolveJobLifecycle } from "@/lib/job-lifecycle";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";

export const dynamic = "force-dynamic";

// Owner scope for the Mine / <Name>'s / All filter (Step 4). Mirrors the
// /clients OwnerScopeSelect: default is the signed-in user's own book,
// scoped by the parent client's owner. Jobs themselves carry no owner.
type OwnerScope = "mine" | "theirs" | "all";

type SortKey =
  | "client"
  | "title"
  | "location"
  | "compensation"
  | "priority"
  | "lastEdited"
  | "submitted"
  | "interviewing"
  | "hired";

const SORT_KEYS: SortKey[] = [
  "client",
  "title",
  "location",
  "compensation",
  "priority",
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
    owner?: string;
  };
}) {
  const rawTab = searchParams?.tab;
  const tab: JobLifecycle =
    rawTab === "private" || rawTab === "inactive" ? rawTab : "active";
  const rawOwner = searchParams?.owner;
  const owner: OwnerScope =
    rawOwner === "theirs" || rawOwner === "all" ? rawOwner : "mine";
  const q = (searchParams?.q ?? "").trim();
  const rawSort = (searchParams?.sort ?? (tab === "active" ? "priority" : "lastEdited")) as SortKey;
  const sort: SortKey = (SORT_KEYS as string[]).includes(rawSort) ? rawSort : "lastEdited";
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";
  const pageParam = parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  let rows: JobRow[] = [];
  let activeCount = 0;
  let privateCount = 0;
  let inactiveCount = 0;
  let error: string | null = null;
  let otherUserName: string | null = null;

  try {
    // Phase 2: Jobs list reads from Neon via the broadened shim —
    // includes both RF-imported and Ace-native Jobs in one iteration.
    const [jobs, candidates, clients, lastTouchedByCuid, org, currentUserId] = await Promise.all([
      getRfJobsForOrg(),
      getRfCandidatesForOrg(),
      getClientsForOrg(),
      // "Last Edited" rolls up signals beyond Job.updatedAt — placements
      // moving stages and activity-log entries against the job both
      // count, otherwise a job that's only seen pipeline traffic shows
      // a stale date. Computed here (page-only) so other getRfJobsForOrg
      // callers don't pay for the joins.
      buildLastTouchedByJobCuid(),
      getCurrentOrg(),
      getCurrentUserId(),
    ]);

    // The "other" org member, for the "<Name>'s Jobs" option. Same
    // two-person-org assumption as /clients: the first member who isn't
    // the signed-in user is the counterpart; null when there is no one.
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: org.id },
      select: { user: { select: { id: true, name: true } } },
    });
    const other = members.map((m) => m.user).find((u) => u.id !== currentUserId) ?? null;
    const otherUserId = other?.id ?? null;
    otherUserName = other?.name ?? null;

    // Map each job's numeric companyId back to its client's owner. Built
    // the same way as verifiedByCompanyId below: RF clients key on
    // legacyRfId, Ace-native clients key on the synthetic djb2 of cuid
    // (the same hash the jobs shim mints for companyId).
    const ownerByCompanyId = new Map<number, string | null>();
    for (const c of clients) {
      const key = c.legacyRfId != null ? c.legacyRfId : syntheticIdFromCuid(c.id);
      ownerByCompanyId.set(key, c.ownerId);
    }

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
    const all: (JobRow & { clientOwnerId: string | null })[] = jobs.map((raw) => {
      const j = normalizeJob(raw);
      const c = counts.get(j.id) ?? emptyJobCounts();
      // Lifecycle pulls from the shim's `_lifecycle` carry-along (set
      // straight from the Neon column); legacy rows that haven't been
      // touched since the migration fall back to the isOpen mapping.
      const rawLifecycle = (raw as { _lifecycle?: string | null })._lifecycle;
      const lifecycle: JobLifecycle = resolveJobLifecycle(rawLifecycle, j.isOpen);
      // RF-imported rows route via the positive legacyRfId (j.id is the
      // real RF id). Ace-native rows have a synthetic negative id that
      // would 404 against /jobs/[id]; route via the cuid carried on
      // `_aceJobId` instead.
      const aceJobId = (raw as { _aceJobId?: string })._aceJobId;
      const slug = j.id < 0 && aceJobId ? aceJobId : String(j.id);
      // Prefer the rolled-up signal over the RF payload's last_opened /
      // created_at (which froze at import for RF rows and is undefined
      // for Ace-native rows). Falls back to the legacy values so a job
      // with no activity still surfaces its created date.
      const touchedMs = aceJobId ? lastTouchedByCuid.get(aceJobId) ?? null : null;
      const lastEditedAt = touchedMs
        ? new Date(touchedMs).toISOString()
        : j.lastEditedAt;
      return {
        ...j,
        jobCuid: aceJobId || "",
        lastEditedAt,
        slug,
        lifecycle,
        websitePriority: (raw as { _websitePriority?: number | null })._websitePriority ?? null,
        publishedToWebsite: (raw as { _publishToWebsite?: boolean })._publishToWebsite ?? false,
        submittedCount: c.submitted,
        interviewingCount: c.interviewing,
        hiredCount: c.hired,
        clientIsVerified:
          j.companyId != null ? verifiedByCompanyId.get(j.companyId) ?? false : false,
        clientOwnerId:
          j.companyId != null ? ownerByCompanyId.get(j.companyId) ?? null : null,
      };
    });

    // Owner scope filter (Step 4). Applied before the lifecycle counts so
    // the Active/Private/Inactive tab badges reflect the current scope,
    // and before pagination so page slices stay correct. "all" is a
    // no-op; "mine"/"theirs" match the parent client's owner.
    const scoped = all.filter((r) => {
      if (owner === "all") return true;
      if (owner === "theirs") return otherUserId != null && r.clientOwnerId === otherUserId;
      return currentUserId != null && r.clientOwnerId === currentUserId;
    });
    for (const r of scoped) {
      if (r.lifecycle === "active") activeCount++;
      else if (r.lifecycle === "private") privateCount++;
      else inactiveCount++;
    }
    rows = scoped.filter((r) => r.lifecycle === tab);

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
        priorityCount={activeCount}
        owner={owner}
        otherUserName={otherUserName}
        error={error}
      />
    </div>
  );
}

// Rolls up the "most recent activity per job" map keyed by Job cuid.
// Sources: Job.updatedAt (covers Prisma's auto-bump on any Job row
// edit), Job.descriptionGeneratedAt (covers the JD regen path),
// Placement.updatedAt grouped by jobId (covers stage moves on the
// pipeline tab), and ActivityLog.timestamp where targetType='job'
// (covers everything that calls logActivity — Mail sends, JD generated,
// etc.). All four signals are merged into a single max-timestamp per
// job. Tenant-scoped via getCurrentOrg() so /jobs never sees another
// org's rollup.
async function buildLastTouchedByJobCuid(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const org = await getCurrentOrg();
  const jobRows = await prisma.job.findMany({
    where: { organizationId: org.id },
    select: { id: true, legacyRfId: true, updatedAt: true, descriptionGeneratedAt: true },
  });
  const cuids = jobRows.map((r) => r.id);
  const rfIdToCuid = new Map<number, string>();
  for (const r of jobRows) {
    if (r.legacyRfId != null) rfIdToCuid.set(r.legacyRfId, r.id);
  }

  const bump = (cuid: string | null | undefined, when: Date | null | undefined) => {
    if (!cuid || !when) return;
    const ms = when.getTime();
    if (!Number.isFinite(ms)) return;
    const cur = out.get(cuid) ?? 0;
    if (ms > cur) out.set(cuid, ms);
  };

  for (const r of jobRows) {
    bump(r.id, r.updatedAt);
    bump(r.id, r.descriptionGeneratedAt);
  }

  if (cuids.length === 0) return out;

  // Phase 0 backfilled Placement.jobId (cuid) for every row, so the
  // cuid-keyed group covers Ace-native + RF-imported. The legacyRfId
  // fallback below picks up any straggler rows that still only carry
  // jobRfId (pre-backfill or hand-inserted).
  const [placementByCuid, placementByRf, activityByTarget] = await Promise.all([
    prisma.placement.groupBy({
      by: ["jobId"],
      where: { organizationId: org.id, jobId: { in: cuids } },
      _max: { updatedAt: true },
    }),
    prisma.placement.groupBy({
      by: ["jobRfId"],
      where: {
        organizationId: org.id,
        jobRfId: { in: Array.from(rfIdToCuid.keys()) },
        jobId: null,
      },
      _max: { updatedAt: true },
    }),
    prisma.activityLog.groupBy({
      by: ["targetId"],
      where: { organizationId: org.id, targetType: "job", targetId: { in: cuids } },
      _max: { timestamp: true },
    }),
  ]);

  for (const p of placementByCuid) bump(p.jobId, p._max.updatedAt);
  for (const p of placementByRf) {
    if (p.jobRfId == null) continue;
    bump(rfIdToCuid.get(p.jobRfId), p._max.updatedAt);
  }
  for (const a of activityByTarget) bump(a.targetId, a._max.timestamp);

  return out;
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
      case "priority":
        return r.websitePriority ?? Number.MAX_SAFE_INTEGER;
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
