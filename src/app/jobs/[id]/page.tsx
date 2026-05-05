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
import { EditableJobDescription } from "@/app/jobs/[id]/editable-job-description";
import {
  EditableJobOverview,
  type JobOverviewInitial,
} from "@/app/jobs/[id]/editable-job-overview";
import { FindMatchesButton } from "@/components/game-plan/find-matches-button";
import AiWorkspace from "@/components/AiWorkspace";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type JobTab = "description" | "game-plan";

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

  const [jobs, candidates, override, localPlacements] = await Promise.all([
    getRfJobsForOrg(),
    getRfCandidatesForOrg(),
    rfId != null ? prisma.jobOverride.findUnique({ where: { jobRfId: rfId } }) : Promise.resolve(null),
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
  const org = await getCurrentOrg();
  const candidateMatches = await prisma.candidateMatch.findMany({
    where: { jobId: jobRow.id, organizationId: org.id },
    orderBy: { score: "desc" },
    include: {
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

  const customFields = Array.isArray(raw.custom_fields) ? raw.custom_fields : [];
  const billingContact = customFields.find((f) => f.name?.toLowerCase() === "billing contact")?.value as string | undefined;

  // Client slug for the "Client profile" button. Prefer the Client row's
  // legacyRfId (back-compat URLs); fall back to cuid for Ace-native.
  const clientSlug = jobRow.clientId
    ? await (async () => {
        const cl = await prisma.client.findUnique({
          where: { id: jobRow.clientId! },
          select: { id: true, legacyRfId: true },
        });
        if (!cl) return null;
        return cl.legacyRfId != null ? String(cl.legacyRfId) : cl.id;
      })()
    : null;

  // Description read order: JobOverride (RF-imported only) > Job.description
  // (Ace-native native column) > raw.description (RF payload fallback).
  const rfDescription = typeof raw.description === "string" ? raw.description : null;

  // Tab selection from ?tab=. Default Job Description so the recruiter
  // lands on the role's content rather than the AI workspace.
  const tab: JobTab = searchParams?.tab === "game-plan" ? "game-plan" : "description";

  // Overview reads come from the Job table directly so saves through
  // EditableJobOverview echo on next revalidate without having to keep
  // Job.raw in sync. RF-imported rows have these columns populated by
  // the importer; values fall back to the normalized RF shape (used for
  // very old imports or partial syncs) or — last-resort — to the raw
  // payload's salary fields.
  const rawSalaryStart =
    typeof raw.salary_range_start === "number" ? raw.salary_range_start : null;
  const rawSalaryEnd =
    typeof raw.salary_range_end === "number" ? raw.salary_range_end : null;
  const rawSalaryCcy =
    typeof raw.salary_range_currency === "string" ? raw.salary_range_currency : null;
  const overviewInitial: JobOverviewInitial = {
    salaryRangeStart: jobRow.salaryRangeStart ?? rawSalaryStart,
    salaryRangeEnd: jobRow.salaryRangeEnd ?? rawSalaryEnd,
    salaryCurrency: jobRow.salaryCurrency ?? rawSalaryCcy,
    locations: Array.isArray(jobRow.locations) && jobRow.locations.length > 0
      ? jobRow.locations
      : (Array.isArray(raw.locations) ? raw.locations : []),
    numberOfOpenings: jobRow.numberOfOpenings ?? raw.number_of_openings ?? null,
    isOpen: jobRow.isOpen,
    employmentType: jobRow.employmentType ?? raw.employment_type ?? null,
    billingContact: billingContact || "",
    lastEditedAt: jobRow.updatedAt.toISOString(),
    applyLink: typeof raw.apply_link === "string" ? raw.apply_link : null,
  };

  return (
    <div className="space-y-5">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg"
      >
        <ArrowLeft className="h-3 w-3" /> Back to jobs
      </Link>

      <div className="flex flex-col gap-1">
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
        <h1 className="font-serif text-3xl font-bold text-court-fg">{job.title}</h1>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <div className="space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <JobTabs slug={isAceNative ? jobRow.id : String(rfId)} tab={tab} />
            {tab === "game-plan" && (
              <FindMatchesButton
                target={{
                  kind: "job",
                  jobId: jobRow.id,
                  jobRfId: rfId,
                  label: `${job.title}${job.company ? ` at ${job.company}` : ""}`,
                }}
              />
            )}
          </div>
          {tab === "game-plan" ? (
            <AiWorkspace entityType="job" entityId={jobRow.id} title="Game Plan" />
          ) : (
            <EditableJobDescription
              jobRfId={rfId}
              jobCuid={isAceNative ? jobRow.id : null}
              rfDescription={rfDescription}
              initialOverride={override?.description ?? null}
            />
          )}
        </div>
        <div className="lg:col-span-3">
          <EditableJobOverview
            jobRfId={rfId}
            jobCuid={isAceNative ? jobRow.id : null}
            initial={overviewInitial}
          />
        </div>
      </div>
    </div>
  );
}

function JobTabs({ slug, tab }: { slug: string; tab: JobTab }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface p-1 shadow-sm">
      <JobTabLink label="Job Description" href={`/jobs/${slug}`} active={tab === "description"} />
      <JobTabLink label="Game Plan" href={`/jobs/${slug}?tab=game-plan`} active={tab === "game-plan"} />
    </div>
  );
}

function JobTabLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "bg-court-accent-tint text-court-accent-dark ring-1 ring-court-accent/40"
          : "text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg",
      )}
    >
      {label}
    </Link>
  );
}

