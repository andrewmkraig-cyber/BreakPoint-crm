import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  normalizeJob,
  flattenPipeline,
  type PipelineBucket,
  type RFJob,
} from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getJobByIdentifier } from "@/lib/jobs";
import { getPlacementsForOrg } from "@/lib/placements";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import {
  JobPipelineSummary,
  type JobMatchedRow,
  type JobPipelineRow,
} from "@/app/jobs/[id]/pipeline-summary";
import { DeleteJobButton } from "@/app/jobs/[id]/delete-job-button";
import {
  JobOverviewTab,
  type JobOverviewSnapshot,
} from "@/app/jobs/[id]/job-overview-tab";
import { JobDescriptionTab } from "@/app/jobs/[id]/job-description-tab";
import { PromoteTab } from "@/app/jobs/[id]/promote-tab";
import { MatchesTab } from "@/app/jobs/[id]/matches-tab";
import AiWorkspace from "@/components/AiWorkspace";
import { ActivityFeed } from "@/components/activity-feed";
import { ensureMajorBoardsSeeded, listJobBoardStatuses } from "@/lib/job-boards";
import { prisma } from "@/lib/prisma";
import { TabStrip } from "@/components/ui/tab-strip";

export const dynamic = "force-dynamic";

// 6-tab job detail surface. Overview is the default landing tab so the
// recruiter sees a snapshot + quick actions before drilling into the
// specific surface. Pipeline is intentionally not its own tab — the
// cross-tab chip strip rendered above the tabs already surfaces the
// staged candidate list with Submit / Reject inline actions.
type JobTab =
  | "overview"
  | "description"
  | "matches"
  | "game-plan"
  | "promote"
  | "activity";

const JOB_TABS: { id: JobTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "description", label: "Job Description" },
  { id: "matches", label: "Matches" },
  { id: "game-plan", label: "Game Plan" },
  { id: "promote", label: "Promote" },
  { id: "activity", label: "Activity" },
];

function parseTab(raw: string | undefined): JobTab {
  const found = JOB_TABS.find((t) => t.id === raw);
  return found ? found.id : "overview";
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  // Phase 2: accept both cuid (Ace-native, post-cutover canonical) and
  // legacy numeric RF id (back-compat for existing URLs / external links).
  const jobRow = await getJobByIdentifier(params.id);
  if (!jobRow) notFound();

  const rfId = jobRow.legacyRfId;
  const isAceNative = rfId == null;

  const [jobs, candidates, localPlacements] = await Promise.all([
    getRfJobsForOrg(),
    getRfCandidatesForOrg(),
    // Phase 4a: Placement read routed through the tenant-scoped
    // helper. The helper picks the right identity shape (jobRfId
    // numeric for RF-imported; jobId cuid for Ace-native) from the
    // jobIdentifier typeof.
    getPlacementsForOrg({
      jobIdentifier: isAceNative ? jobRow.id : (rfId as number),
    }),
  ]);

  // Locate the RFJob-shaped payload for display. RF-imported rows land
  // via legacyRfId match; Ace-native rows land via the synthetic-id
  // treatment inside getRfJobsForOrg (shim surfaces them keyed on
  // -djb2(cuid)). Falls back to a minimal shape built from the Neon
  // Job row if the shim-side build hasn't caught up yet.
  const raw: RFJob =
    (isAceNative
      ? jobs.find((j) => (j as { _aceJobId?: string })._aceJobId === jobRow.id)
      : jobs.find((j) => j.id === rfId)) ??
    ({
      id: rfId ?? 0,
      title: jobRow.title,
      is_open: jobRow.isOpen,
      locations: jobRow.locations,
      description: jobRow.description ?? undefined,
    } as RFJob);

  const job = normalizeJob(raw);

  // Local stage overlay: RF-imported candidates are keyed by
  // candidateRfId; Ace-native candidates by candidateId. Two maps keep
  // the lookup keys type-correct without string-munging cuids vs ints.
  const stageByRfCandidate = new Map<number, { stage: string; movedAt: string }>();
  const stageByAceCandidate = new Map<string, { stage: string; movedAt: string }>();
  for (const p of localPlacements) {
    if (p.candidateRfId != null) {
      stageByRfCandidate.set(p.candidateRfId, { stage: p.stage, movedAt: p.updatedAt.toISOString() });
    } else if (p.candidateId) {
      stageByAceCandidate.set(p.candidateId, { stage: p.stage, movedAt: p.updatedAt.toISOString() });
    }
  }

  // RF-sourced rows only apply to RF-imported Jobs. Ace-native Jobs
  // never appear in c.jobs[] arrays (that field comes from RF payloads),
  // so `flatForJob` is empty for them — pipelineRows is built entirely
  // from the local Placement rows below.
  const flatForJob = rfId != null
    ? flattenPipeline(candidates).filter((r) => r.jobId === rfId)
    : [];
  const mainPipelineRows: JobPipelineRow[] = flatForJob.map((r) => {
    const local = stageByRfCandidate.get(r.candidateId);
    if (local) {
      return {
        candidateId: r.candidateId,
        candidateName: r.candidateName,
        candidateTitle: r.candidateTitle,
        stageName: local.stage,
        bucket: local.stage as PipelineBucket,
        stageMovedAt: local.movedAt,
      };
    }
    return {
      candidateId: r.candidateId,
      candidateName: r.candidateName,
      candidateTitle: r.candidateTitle,
      stageName: r.stageName,
      bucket: "sourced",
      stageMovedAt: r.stageMovedAt,
    };
  });

  const rfCandidateIdsInFlat = new Set(flatForJob.map((r) => r.candidateId));
  const aceNativeIdsNeeded = new Set<string>();
  for (const p of localPlacements) {
    if (p.candidateRfId == null && p.candidateId) {
      aceNativeIdsNeeded.add(p.candidateId);
    }
  }
  const aceNativeCandidates = aceNativeIdsNeeded.size > 0
    ? await prisma.candidate.findMany({
        where: { id: { in: Array.from(aceNativeIdsNeeded) } },
        select: { id: true, firstName: true, lastName: true, currentDesignation: true },
      })
    : [];
  const aceNativeById = new Map(aceNativeCandidates.map((c) => [c.id, c]));

  const extraRows: JobPipelineRow[] = [];
  for (const p of localPlacements) {
    if (p.candidateRfId != null) {
      if (rfCandidateIdsInFlat.has(p.candidateRfId)) continue;
      const rfCand = candidates.find((c) => c.id === p.candidateRfId) ?? null;
      const candidateName = rfCand
        ? [rfCand.first_name, rfCand.last_name].filter(Boolean).join(" ") || rfCand.name || "(unnamed)"
        : `Candidate #${p.candidateRfId}`;
      const candidateTitle = rfCand?.current_designation ?? "";
      extraRows.push({
        candidateId: p.candidateRfId,
        candidateName,
        candidateTitle,
        stageName: p.stage,
        bucket: p.stage as PipelineBucket,
        stageMovedAt: p.updatedAt.toISOString(),
      });
      continue;
    }
    if (p.candidateId) {
      const ace = aceNativeById.get(p.candidateId);
      const candidateName = ace
        ? [ace.firstName, ace.lastName].filter(Boolean).join(" ") || "(unnamed)"
        : "(unnamed)";
      extraRows.push({
        candidateId: p.candidateId,
        candidateName,
        candidateTitle: ace?.currentDesignation ?? "",
        stageName: p.stage,
        bucket: p.stage as PipelineBucket,
        stageMovedAt: p.updatedAt.toISOString(),
      });
    }
  }

  const pipelineRows: JobPipelineRow[] = [...mainPipelineRows, ...extraRows];

  // Game Plan Phase 2: pull every CandidateMatch row Find Matches has
  // logged for this job. Tenant-scoped on the resolved org. Joins the
  // candidate so we can render name + title + employer + location
  // without a second query per row.
  //
  // Anyone the recruiter has already acted on (applied / submitted /
  // interviewing / rejected / etc.) lives in the pipeline buckets
  // above — exclude them from Matched so the tab stays focused on
  // candidates that still need a triage decision. The exclusion is
  // any Placement for this job, regardless of stage.
  const org = await getCurrentOrg();
  const placedCandidateIds = Array.from(
    new Set(
      localPlacements
        .map((p) => p.candidateId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const candidateMatches = await prisma.candidateMatch.findMany({
    where: {
      jobId: jobRow.id,
      organizationId: org.id,
      ...(placedCandidateIds.length > 0
        ? { candidateId: { notIn: placedCandidateIds } }
        : {}),
    },
    orderBy: { score: "desc" },
    select: {
      score: true,
      rationale: true,
      scoreBreakdown: true,
      candidate: {
        select: {
          id: true,
          rfId: true,
          firstName: true,
          lastName: true,
          currentDesignation: true,
          currentOrganization: true,
          location: true,
        },
      },
    },
  });
  const matchedRows: JobMatchedRow[] = candidateMatches.map((m) => {
    const c = m.candidate;
    return {
      candidateId: c.id,
      candidateRfId: c.rfId,
      name:
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
        "(no name)",
      title: c.currentDesignation ?? "",
      employer: c.currentOrganization ?? "",
      location: c.location ?? "",
      score: m.score,
      rationale: m.rationale,
      scoreBreakdown: m.scoreBreakdown,
    };
  });

  // Client slug for the "Client profile" button. Prefer the Client row's
  // legacyRfId (back-compat URLs); fall back to cuid for Ace-native.
  // Also pulls customFields so the Overview tab can derive fee % (no
  // dedicated column — same parse the /clients list uses).
  const clientRow = jobRow.clientId
    ? await prisma.client.findUnique({
        where: { id: jobRow.clientId },
        select: { id: true, legacyRfId: true, customFields: true },
      })
    : null;
  const clientSlug = clientRow
    ? clientRow.legacyRfId != null
      ? String(clientRow.legacyRfId)
      : clientRow.id
    : null;
  const clientFeePct = extractFeePct(clientRow?.customFields ?? null);

  // Tab selection from ?tab=. Default Overview so the recruiter lands
  // on a snapshot + quick actions before drilling into a specific surface.
  const tab: JobTab = parseTab(searchParams?.tab);

  // Lazy per-tab loads. Keep the eager queries above lean (the same
  // payload every tab needs) and only fetch tab-specific shapes when
  // the recruiter is on that tab. Promote also lazy-seeds the 6 majors
  // for jobs that predate the JobBoardStatus table — first render is
  // slightly slower for legacy jobs, every subsequent render is cached.
  let promoteRows: Awaited<ReturnType<typeof listJobBoardStatuses>> = [];
  if (tab === "promote") {
    await ensureMajorBoardsSeeded({ jobId: jobRow.id, organizationId: org.id });
    promoteRows = await listJobBoardStatuses({
      jobId: jobRow.id,
      organizationId: org.id,
    });
  }

  // Overview reads come from the Job table directly so inline-edit
  // saves through updateJobOverview echo on next revalidate without
  // having to keep Job.raw in sync. RF-imported rows have these
  // columns populated by the importer; values fall back to the
  // normalized RF shape (used for very old imports or partial syncs)
  // or — last-resort — to the raw payload's salary fields.
  const rawSalaryStart =
    typeof raw.salary_range_start === "number" ? raw.salary_range_start : null;
  const rawSalaryEnd =
    typeof raw.salary_range_end === "number" ? raw.salary_range_end : null;
  const rawSalaryCcy =
    typeof raw.salary_range_currency === "string" ? raw.salary_range_currency : null;
  const rawSalaryFreq =
    typeof raw.salary_frequency === "string" ? raw.salary_frequency : null;
  const overviewFields = {
    salaryRangeStart: jobRow.salaryRangeStart ?? rawSalaryStart,
    salaryRangeEnd: jobRow.salaryRangeEnd ?? rawSalaryEnd,
    salaryCurrency: jobRow.salaryCurrency ?? rawSalaryCcy,
    salaryFrequency:
      (jobRow.salaryFrequency ?? rawSalaryFreq) === "hourly"
        ? ("hourly" as const)
        : ("yearly" as const),
    locations:
      Array.isArray(jobRow.locations) && jobRow.locations.length > 0
        ? jobRow.locations
        : Array.isArray(raw.locations)
          ? raw.locations
          : [],
    numberOfOpenings: jobRow.numberOfOpenings ?? raw.number_of_openings ?? null,
    employmentType: jobRow.employmentType ?? raw.employment_type ?? null,
    lastEditedAt: jobRow.updatedAt.toISOString(),
    applyLink: typeof raw.apply_link === "string" ? raw.apply_link : null,
  };

  // Tab nav slug — RF-imported jobs keep their numeric URLs for back-
  // compat; Ace-native jobs route on cuid.
  const slug = isAceNative ? jobRow.id : String(rfId);

  const matchTarget = {
    kind: "job" as const,
    jobId: jobRow.id,
    jobRfId: rfId,
    label: `${job.title}${job.company ? ` at ${job.company}` : ""}`,
  };

  // Lifecycle derives from the new column, falling back to isOpen for
  // any legacy row that hasn't been touched since the migration.
  const lifecycle: "active" | "private" | "inactive" =
    jobRow.lifecycle === "private"
      ? "private"
      : jobRow.lifecycle === "inactive"
        ? "inactive"
        : jobRow.isOpen
          ? "active"
          : "inactive";

  const overviewSnapshot: JobOverviewSnapshot = {
    jobId: jobRow.id,
    title: job.title,
    clientName: job.company || "",
    locations: overviewFields.locations,
    lifecycle,
    employmentType: overviewFields.employmentType,
    compensation: formatCompSummary(overviewFields),
    feePct: clientFeePct,
    numberOfOpenings: overviewFields.numberOfOpenings,
    lastEditedAt: overviewFields.lastEditedAt,
    applyLink: overviewFields.applyLink,
    salaryRangeStart: overviewFields.salaryRangeStart,
    salaryRangeEnd: overviewFields.salaryRangeEnd,
    salaryCurrency: overviewFields.salaryCurrency,
    salaryFrequency: overviewFields.salaryFrequency,
  };

  return (
    // Tightened vertical stack so the page header (Back link + client +
    // title + pipeline chips + tabs) sits closer to the app shell's top
    // header. Matches the visual density of /jobs and /candidates list
    // views — the prior space-y-5 pushed Matches/Description content
    // far enough down that the Save search button on the Matches sidebar
    // clipped below the fold.
    <div className="space-y-3">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg"
      >
        <ArrowLeft className="h-3 w-3" /> Back to jobs
      </Link>

      <div className="flex flex-col gap-0.5">
        {clientSlug ? (
          <Link
            href={`/clients/${clientSlug}`}
            className="text-sm font-semibold uppercase tracking-widest text-court-accent transition hover:underline"
          >
            {job.company || "Client"}
          </Link>
        ) : (
          <div className="text-sm font-semibold uppercase tracking-widest text-court-accent">
            {job.company || "Client"}
          </div>
        )}
        <h1 className="font-serif text-2xl font-bold text-court-fg">{job.title}</h1>
      </div>

      {/* Compact pipeline strip — single chip row sitting directly above
          the main content. Click a chip to expand its row table; click
          Matched to open the (paginated) Matched panel. */}
      <JobPipelineSummary
        compact
        rows={pipelineRows}
        jobActions={{
          jobRfId: rfId ?? 0,
          jobCuid: isAceNative ? jobRow.id : null,
          clientRfId: job.companyId ?? 0,
          clientCuid: jobRow.clientId ?? null,
          jobTitle: job.title,
          clientName: job.company || "",
        }}
        matched={{
          rows: matchedRows,
          jobId: jobRow.id,
          jobRfId: rfId,
        }}
      />

      <div className="space-y-3">
        <JobTabs slug={slug} tab={tab} />
        {tab === "overview" ? (
          <JobOverviewTab
            snapshot={overviewSnapshot}
            jobRfId={rfId}
            jobCuid={isAceNative ? jobRow.id : null}
          />
        ) : tab === "description" ? (
          <JobDescriptionTab
            jobId={jobRow.id}
            initialDescription={jobRow.description ?? null}
            initialDescriptionGeneratedAt={
              jobRow.descriptionGeneratedAt
                ? jobRow.descriptionGeneratedAt.toISOString()
                : null
            }
            initialSearchKeywords={jobRow.searchKeywords ?? null}
            jobMeta={{
              title: job.title,
              clientName: job.company || "",
              location: overviewSnapshot.locations.join(", "),
              compensation: overviewSnapshot.compensation,
            }}
            matchTarget={matchTarget}
          />
        ) : tab === "promote" ? (
          <PromoteTab
            jobId={jobRow.id}
            applyLink={overviewFields.applyLink}
            rows={promoteRows}
          />
        ) : tab === "game-plan" ? (
          <AiWorkspace entityType="job" entityId={jobRow.id} />
        ) : tab === "activity" ? (
          <ActivityFeed entityType="job" entityId={jobRow.id} />
        ) : tab === "matches" ? (
          <MatchesTab
            jobCuid={jobRow.id}
            jobRfId={rfId}
            jobTitle={job.title}
            savedFilters={jobRow.savedSearchFilters as unknown}
            searchKeywords={jobRow.searchKeywords ?? null}
          />
        ) : (
          <TabStub label={JOB_TABS.find((t) => t.id === tab)?.label ?? ""} />
        )}
      </div>

      <DeleteJobButton jobId={jobRow.id} jobTitle={job.title} />
    </div>
  );
}

function JobTabs({ slug, tab }: { slug: string; tab: JobTab }) {
  return (
    <TabStrip<JobTab>
      ariaLabel="Job sections"
      activeId={tab}
      items={JOB_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        href: t.id === "overview" ? `/jobs/${slug}` : `/jobs/${slug}?tab=${t.id}`,
      }))}
    />
  );
}

function TabStub({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-court-border bg-court-surface-subtle/50 p-8 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {label}
      </div>
      <div className="mt-1 text-sm text-court-fg-muted">Coming soon.</div>
    </div>
  );
}

// Same fee-% parse the /clients list uses, narrowed to the shape Prisma
// returns for Client.customFields (Json column). Returns null when the
// field is missing or unparseable.
function extractFeePct(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const name = (f as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    const lower = name.toLowerCase();
    if (!(lower.includes("avg fee") || lower.includes("fee %") || lower.includes("fee percent"))) continue;
    const value = (f as { value?: unknown }).value;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

// Inline summary string for the Overview snapshot. Mirrors the
// compensation formatter inside JobOverviewTab so the server can render
// the initial display without pulling the client module.
function formatCompSummary(state: {
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: "yearly" | "hourly";
}): string {
  const { salaryRangeStart: lo, salaryRangeEnd: hi, salaryCurrency, salaryFrequency } = state;
  if (lo == null && hi == null) return "—";
  const ccy = (salaryCurrency ?? "USD").toUpperCase();
  const symbol = ccy === "USD" ? "$" : `${ccy} `;
  const fmt = (n: number) => `${symbol}${n.toLocaleString()}`;
  const suffix = salaryFrequency === "hourly" ? " / hr" : " / yr";
  if (lo != null && hi != null && lo !== hi) return `${fmt(lo)} – ${fmt(hi)}${suffix}`;
  const only = lo ?? hi!;
  return `${fmt(only)}${suffix}`;
}


