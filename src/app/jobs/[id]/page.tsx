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
import { extractFeePctFromCustomFields } from "@/lib/clients";
import { getPlacementsForOrg } from "@/lib/placements";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getCurrentUserId } from "@/lib/auth/getCurrentUserId";
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
import { EntityNotesSection } from "@/components/notes/entity-notes-section";
import { publicJobSlug } from "@/lib/public-job-slug";
import { prisma } from "@/lib/prisma";
import { TabStrip } from "@/components/ui/tab-strip";

export const dynamic = "force-dynamic";

// 5-tab job detail surface. Overview is the default landing tab so the
// recruiter sees a snapshot + quick actions before drilling into the
// specific surface. Pipeline is intentionally not its own tab — the
// cross-tab chip strip rendered above the tabs already surfaces the
// staged candidate list with Submit / Reject inline actions.
type JobTab =
  | "overview"
  | "description"
  | "matches"
  | "game-plan"
  | "activity";

const JOB_TABS: { id: JobTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "description", label: "Job Description" },
  { id: "matches", label: "Matches" },
  { id: "game-plan", label: "Game Plan" },
  { id: "activity", label: "Activity" },
];

function parseTab(raw: string | undefined): JobTab {
  // Old Website-tab links now land on Overview, where those controls live.
  if (raw === "promote") return "overview";
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

  // Hoisted ahead of the pipeline-rows fetch so the scheduled-interview
  // query below can scope by organizationId without a second await
  // gate. Reused later for the Game Plan / Matched query.
  const org = await getCurrentOrg();

  const [jobs, candidates, localPlacements, scheduledInterviews] = await Promise.all([
    getRfJobsForOrg(),
    getRfCandidatesForOrg(),
    // Phase 4a: Placement read routed through the tenant-scoped
    // helper. The helper picks the right identity shape (jobRfId
    // numeric for RF-imported; jobId cuid for Ace-native) from the
    // jobIdentifier typeof.
    getPlacementsForOrg({
      jobIdentifier: isAceNative ? jobRow.id : (rfId as number),
    }),
    // Next-upcoming interview per candidate for the pipeline row's
    // Edit Interview button. status="scheduled" + scheduledAt > now
    // is the same filter the candidate-profile row uses; ordering asc
    // means the first hit per candidate is the next one.
    prisma.interview.findMany({
      where: {
        organizationId: org.id,
        status: "scheduled",
        scheduledAt: { gt: new Date() },
        ...(isAceNative ? { jobId: jobRow.id } : { jobRfId: rfId as number }),
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true,
        scheduledAt: true,
        type: true,
        candidateRfId: true,
        candidateId: true,
      },
    }),
  ]);

  // Earliest future scheduled interview per candidate. Two maps because
  // RF-imported and Ace-native candidates carry incompatible id types.
  const nextInterviewByRfCandidate = new Map<number, { id: string; scheduledAt: string; type: string }>();
  const nextInterviewByAceCandidate = new Map<string, { id: string; scheduledAt: string; type: string }>();
  for (const iv of scheduledInterviews) {
    if (iv.candidateRfId != null && !nextInterviewByRfCandidate.has(iv.candidateRfId)) {
      nextInterviewByRfCandidate.set(iv.candidateRfId, {
        id: iv.id,
        scheduledAt: iv.scheduledAt.toISOString(),
        type: iv.type,
      });
    } else if (iv.candidateId && !nextInterviewByAceCandidate.has(iv.candidateId)) {
      nextInterviewByAceCandidate.set(iv.candidateId, {
        id: iv.id,
        scheduledAt: iv.scheduledAt.toISOString(),
        type: iv.type,
      });
    }
  }

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
    const nextInterview = nextInterviewByRfCandidate.get(r.candidateId) ?? null;
    if (local) {
      return {
        candidateId: r.candidateId,
        candidateName: r.candidateName,
        candidateTitle: r.candidateTitle,
        stageName: local.stage,
        bucket: local.stage as PipelineBucket,
        stageMovedAt: local.movedAt,
        nextInterview,
      };
    }
    return {
      candidateId: r.candidateId,
      candidateName: r.candidateName,
      candidateTitle: r.candidateTitle,
      stageName: r.stageName,
      bucket: "sourced",
      stageMovedAt: r.stageMovedAt,
      nextInterview,
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
        nextInterview: nextInterviewByRfCandidate.get(p.candidateRfId) ?? null,
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
        nextInterview: nextInterviewByAceCandidate.get(p.candidateId) ?? null,
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
  // Also pulls feePct (canonical) + customFields (legacy fallback) so the
  // Overview tab can show the client's fee % on the job.
  const [clientRow, jobOverride, currentUserId] = await Promise.all([
    jobRow.clientId
      ? prisma.client.findUnique({
        where: { id: jobRow.clientId },
        select: {
          id: true,
          legacyRfId: true,
          feePct: true,
          customFields: true,
          ownerId: true,
        },
      })
      : Promise.resolve(null),
    prisma.jobOverride.findUnique({
      where: { jobId: jobRow.id },
      select: { description: true },
    }),
    getCurrentUserId(),
  ]);
  const clientSlug = clientRow
    ? clientRow.legacyRfId != null
      ? String(clientRow.legacyRfId)
      : clientRow.id
    : null;
  // Canonical-first: Client.feePct is the column the signed-agreement
  // auto-fill + the client Overview edit write to. The legacy RF
  // "Avg Fee %" custom field is fallback-only for unbackfilled imports.
  // The job inherits the client's fee live, so every current and future
  // job shows it the moment the client has one (no per-job snapshot to
  // drift). Mirrors the candidate-profile placement read in local-profile.tsx.
  const clientFeePct =
    clientRow?.feePct ?? extractFeePctFromCustomFields(clientRow?.customFields ?? null);

  // Tab selection from ?tab=. Default Overview so the recruiter lands
  // on a snapshot + quick actions before drilling into a specific surface.
  const tab: JobTab = parseTab(searchParams?.tab);

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
    workplaceType: jobRow.workplaceType ?? null,
    hybridSchedule: jobRow.hybridSchedule ?? null,
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

  const effectiveDescription =
    jobOverride?.description?.trim() ||
    jobRow.description?.trim() ||
    (typeof raw.description === "string" ? raw.description.trim() : "");
  const websiteSlug = publicJobSlug({
    id: jobRow.id,
    title: jobRow.title,
    locationCity: jobRow.locationCity,
    locationState: jobRow.locationState,
  });
  const websiteRequirements = [
    {
      label: "Active in My Jobs",
      met:
        lifecycle === "active" &&
        jobRow.isOpen &&
        Boolean(currentUserId && clientRow?.ownerId === currentUserId),
      detail: "The role must be Active and belong to your My Jobs list.",
    },
    {
      label: "Complete job description",
      met: Boolean(effectiveDescription),
      detail: effectiveDescription
        ? "A candidate-facing description is ready."
        : "Add a description on the Job Description tab.",
    },
    {
      label: "Structured location",
      met: Boolean(jobRow.locationCity && jobRow.locationState),
      detail: jobRow.locationCity && jobRow.locationState
        ? `${jobRow.locationCity}, ${jobRow.locationState}`
        : "Add a city and state on the Overview tab.",
    },
    {
      label: "Employment type",
      met: Boolean(overviewFields.employmentType),
      detail: overviewFields.employmentType || "Add an employment type on the Overview tab.",
    },
    {
      label: "Workplace type",
      met: Boolean(overviewFields.workplaceType),
      detail: overviewFields.workplaceType || "Choose On-site, Hybrid, or Remote on the Overview tab.",
    },
    ...(overviewFields.workplaceType === "Hybrid"
      ? [{
          label: "Days in office",
          met: Boolean(overviewFields.hybridSchedule),
          detail: overviewFields.hybridSchedule || "Choose a Hybrid schedule on the Overview tab.",
        }]
      : []),
  ];

  const overviewSnapshot: JobOverviewSnapshot = {
    jobId: jobRow.id,
    title: job.title,
    clientName: job.company || "",
    locations: overviewFields.locations,
    // Structured location for the inline edit form. Pre-fills from the
    // Job columns; null on loose/region-only legacy jobs (those render
    // empty until the recruiter edits and supplies a valid trio).
    locationCity: jobRow.locationCity,
    locationState: jobRow.locationState,
    locationZip: jobRow.locationZip,
    lifecycle,
    employmentType: overviewFields.employmentType,
    workplaceType: overviewFields.workplaceType,
    hybridSchedule: overviewFields.hybridSchedule,
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
          <>
            <JobOverviewTab
              snapshot={overviewSnapshot}
              jobRfId={rfId}
              jobCuid={isAceNative ? jobRow.id : null}
            />
            <PromoteTab
              jobId={jobRow.id}
              published={jobRow.publishToWebsite}
              websiteUrl={`https://breakpointtalent.com/jobs/${websiteSlug}/`}
              requirements={websiteRequirements}
            />
            {/* Delete lives inline at the very end of the Overview
                surface (not the other tabs) and scrolls away with the
                page — mirrors DeleteCandidateButton (Profile tab) and
                DeleteClientButton (Overview tab) from 4155f68. */}
            <DeleteJobButton jobId={jobRow.id} jobTitle={job.title} />
          </>
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
          />
        ) : tab === "game-plan" ? (
          <AiWorkspace entityType="job" entityId={jobRow.id} bottomGapRem={30} />
        ) : tab === "activity" ? (
          <div className="space-y-6">
            <EntityNotesSection entityType="job" entityId={jobRow.id} />
            <ActivityFeed entityType="job" entityId={jobRow.id} />
          </div>
        ) : tab === "matches" ? (
          <MatchesTab
            jobCuid={jobRow.id}
            jobRfId={rfId}
            jobTitle={job.title}
            savedFilters={jobRow.savedSearchFilters as unknown}
            searchKeywords={jobRow.searchKeywords ?? null}
            matchTarget={matchTarget}
          />
        ) : (
          <TabStub label={JOB_TABS.find((t) => t.id === tab)?.label ?? ""} />
        )}
      </div>
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

// Fee-% extractor moved to src/lib/clients.ts as
// extractFeePctFromCustomFields so the candidate page, the Ace-native
// row seed path, and scripts/backfill-client-feepct.ts can all reuse
// the same parser. Imported at the top of this file.

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
