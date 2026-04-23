import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Users, Building2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  normalizeJob,
  flattenPipeline,
  type PipelineBucket,
} from "@/lib/recruiterflow";
import { getRfCandidatesForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { JobPipelineSummary, type JobPipelineRow } from "@/app/jobs/[id]/pipeline-summary";
import { EditableJobDescription } from "@/app/jobs/[id]/editable-job-description";
import { prisma } from "@/lib/prisma";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [jobs, candidates, override, localPlacements] = await Promise.all([
    getRfJobsForOrg(),
    getRfCandidatesForOrg(),
    prisma.jobOverride.findUnique({ where: { jobRfId: id } }),
    // Local Placement state for this job. Two row shapes share this
    // table: RF-imported candidates carry candidateRfId (number) and
    // Ace-native candidates carry candidateId (cuid string). We want
    // both on the pipeline — pre-Phase-1 the query was scoped to
    // candidateRfId only, so Ace-native Applies were invisible here.
    // Pulling the candidateId column lets the renderer below build
    // Ace-native rows via a Neon Candidate lookup.
    prisma.placement.findMany({
      where: { jobRfId: id },
      select: {
        candidateRfId: true,
        candidateId: true,
        stage: true,
        updatedAt: true,
      },
    }),
  ]);
  const raw = jobs.find((j) => j.id === id);
  if (!raw) notFound();

  const job = normalizeJob(raw);

  // Local stage overlay: candidateRfId → { stage, movedAt }. Local
  // Placement is the source of truth for every stage Ace knows
  // about. RF's c.jobs[].stage_name is only used for candidates
  // that DON'T have a local Placement row yet (the long tail of
  // sourced rows). The 60s RF data-cache TTL means RF stage_name
  // can lag a recently-clicked action; trusting local first means
  // Reject / Submit / Apply / etc. move the row immediately.
  const stageByCandidate = new Map<number, { stage: string; movedAt: string }>();
  for (const p of localPlacements) {
    if (p.candidateRfId == null) continue;
    stageByCandidate.set(p.candidateRfId, {
      stage: p.stage,
      movedAt: p.updatedAt.toISOString(),
    });
  }

  const flatForJob = flattenPipeline(candidates).filter((r) => r.jobId === id);
  const mainPipelineRows: JobPipelineRow[] = flatForJob.map((r) => {
    const local = stageByCandidate.get(r.candidateId);
    if (local) {
      // Local Placement.stage is the source of truth — pass it through
      // raw. No canonicalStage() wrapper; the stage is already written
      // in the canonical-string shape by the server actions.
      return {
        candidateId: r.candidateId,
        candidateName: r.candidateName,
        candidateTitle: r.candidateTitle,
        stageName: local.stage,
        bucket: local.stage as PipelineBucket,
        stageMovedAt: local.movedAt,
      };
    }
    // RF-only candidate (never touched by Ace on this job). Show them
    // as "sourced" so the recruiter gets Apply / Submit / Keep / Reject
    // on the row and can engage from here. Dropped the previous
    // canonicalStage(RF stage_name) computation.
    return {
      candidateId: r.candidateId,
      candidateName: r.candidateName,
      candidateTitle: r.candidateTitle,
      stageName: r.stageName,
      bucket: "sourced",
      stageMovedAt: r.stageMovedAt,
    };
  });

  // Union in local Placements that aren't already represented in
  // mainPipelineRows. Two cases:
  //   1. RF-imported candidate with a Placement row but no matching
  //      c.jobs[] entry yet (60s RF list cache hasn't caught up on a
  //      recent Apply/Submit).
  //   2. Ace-native candidate (candidateRfId null, candidateId set) —
  //      applyLocalCandidateToJob writes these and flattenPipeline
  //      never sees them. Pre-Phase-1 their rows were invisible here;
  //      the reader widening + this branch surface them so the Job
  //      page Applied bucket shows Tyler Brennan (and friends).
  //
  // Same root cause as commit 8a40cdd (Ace-native candidate profile
  // couldn't see its own Submit button) — the pattern is "local
  // Placement exists but the renderer only knew about one key shape."
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
    // RF-path row.
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
    // Ace-native row (candidateRfId null, candidateId set).
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

  // Recompute the top-row Submitted/Interviewing/Hired counts off
  // the overlaid pipelineRows so they match what the recruiter
  // actually sees in the columns below — buildJobCounts only knew
  // about RF stage_name and would over-count Hired-to-cancelled
  // candidates as still Hired.
  const counts = pipelineRows.reduce(
    (acc, r) => {
      if (r.bucket === "submitted") acc.submitted += 1;
      if (r.bucket === "interviewing") acc.interviewing += 1;
      if (r.bucket === "hired") acc.hired += 1;
      return acc;
    },
    { submitted: 0, interviewing: 0, hired: 0 },
  );

  const billingContact = raw.custom_fields?.find((f) => f.name?.toLowerCase() === "billing contact")?.value as string | undefined;
  const feePct = raw.custom_fields?.find((f) => f.name?.toLowerCase().includes("client fee"))?.value as number | undefined;
  const estFee = raw.custom_fields?.find((f) => f.name?.toLowerCase().includes("estimated fee") || f.name?.toLowerCase().includes("etimated fee"))?.value as number | undefined;

  return (
    <div className="space-y-6">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg"
      >
        <ArrowLeft className="h-3 w-3" /> Back to jobs
      </Link>

      <PageHeader
        eyebrow={job.company || "Client"}
        title={job.title}
        description={[job.jobType, job.employmentType, job.location].filter(Boolean).join(" · ")}
        actions={
          job.companyId ? (
            <Link
              href={`/clients/${job.companyId}`}
              className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface px-3 py-2 text-xs font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
            >
              <Building2 className="h-3 w-3" /> Client profile
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatusCard isOpen={job.isOpen} />
        <Stat label="Submitted" value={counts.submitted} />
        <Stat label="Interviewing" value={counts.interviewing} />
        <Stat label="Hired" value={counts.hired} />
      </div>

      <div className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <h2 className="font-serif text-lg font-semibold text-court-fg">Overview</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DT label="Compensation" value={job.compensation || "—"} />
          <DT label="Openings" value={String(job.openings ?? "—")} />
          <DT label="Location" value={job.location || "—"} icon={<MapPin className="h-3 w-3" />} />
          <DT label="Job Type" value={[job.jobType, job.employmentType].filter(Boolean).join(" · ") || "—"} />
          <DT label="Status (RF)" value={job.statusName || (job.isOpen ? "Active" : "Closed")} />
          <DT label="Last Edited" value={formatDate(job.lastEditedAt)} />
          <DT label="Billing Contact" value={billingContact || "—"} />
          <DT label="Fee" value={feePct ? `${feePct}%${estFee ? ` (est. $${estFee.toLocaleString()})` : ""}` : "—"} />
        </dl>
        {raw.apply_link && (
          <div className="mt-5 border-t border-court-border pt-4">
            <Link
              href={raw.apply_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline"
            >
              Public apply link <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-court-fg">Pipeline</h2>
          <div className="inline-flex items-center gap-1 text-xs text-court-fg-muted">
            <Users className="h-3 w-3" />
            {pipelineRows.length} {pipelineRows.length === 1 ? "candidate" : "candidates"}
          </div>
        </div>
        {pipelineRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-court-fg-muted">
            No candidates have been added to this job yet.
          </div>
        ) : (
          <div className="mt-4">
            <JobPipelineSummary
              rows={pipelineRows}
              jobActions={{
                jobRfId: id,
                // RF jobs may have no company link; fall back to 0 so the
                // Placement schema still has a numeric clientRfId. The
                // server actions tolerate this — it just means the local
                // Placement row points to "no client", which shows up as
                // unknown on downstream UI but doesn't block the action.
                clientRfId: job.companyId ?? 0,
                jobTitle: job.title,
                clientName: job.company || "",
              }}
            />
          </div>
        )}
      </div>

      <EditableJobDescription
        jobRfId={id}
        rfDescription={typeof raw.description === "string" ? raw.description : null}
        initialOverride={override?.description ?? null}
      />
    </div>
  );
}

function DT({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-court-fg-muted">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-court-fg">
        {icon}
        {value}
      </dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-xl border border-court-border bg-court-surface px-4 py-2.5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">{label}</div>
      <div className="font-serif text-4xl font-extrabold leading-none tracking-tight text-court-fg">
        {value}
      </div>
    </div>
  );
}

// Status occupies the same stat-card slot as the count tiles but renders
// its value as a small pill instead of giant numerals — "Active" used to
// blow up to a 4xl serif italic and looked garish next to clean numbers.
function StatusCard({ isOpen }: { isOpen: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-court-border bg-court-surface px-4 py-2.5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">Status</div>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
          isOpen
            ? "bg-brand-tint text-brand-dark"
            : "bg-court-surface-subtle text-court-fg-muted",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isOpen ? "bg-brand-dark" : "bg-court-fg-muted",
          )}
        />
        {isOpen ? "Active" : "Inactive"}
      </span>
    </div>
  );
}
