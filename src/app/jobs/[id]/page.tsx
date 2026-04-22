import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Users, Building2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  recruiterflow,
  normalizeJob,
  flattenPipeline,
  type PipelineBucket,
} from "@/lib/recruiterflow";
import { JobPipelineSummary, type JobPipelineRow } from "@/app/jobs/[id]/pipeline-summary";
import { EditableJobDescription } from "@/app/jobs/[id]/editable-job-description";
import { prisma } from "@/lib/prisma";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [jobs, candidates, override, localPlacements] = await Promise.all([
    recruiterflow.listAllJobs({ perPage: 100 }),
    recruiterflow.listAllCandidates({ perPage: 100 }),
    prisma.jobOverride.findUnique({ where: { jobRfId: id } }),
    // Local Placement state for this job's RF candidates. RF doesn't
    // accept stage moves to "rejected" / "offer" / "pending_start" /
    // "hired" / "cancelled" via /external (see trySyncRfStage), so
    // those buckets only ever live in Postgres. Without overlaying
    // them here, clicking Reject in the pipeline row would write
    // stage="rejected" locally but the row would stay under Sourced
    // because flattenPipeline only reads RF stage_name.
    prisma.placement.findMany({
      where: { jobRfId: id, candidateRfId: { not: null } },
      select: {
        candidateRfId: true,
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
  const localByCandidate = new Map<number, { stage: string; movedAt: string }>();
  for (const p of localPlacements) {
    if (p.candidateRfId == null) continue;
    localByCandidate.set(p.candidateRfId, {
      stage: p.stage,
      movedAt: p.updatedAt.toISOString(),
    });
  }

  const flatForJob = flattenPipeline(candidates).filter((r) => r.jobId === id);
  const pipelineRows: JobPipelineRow[] = flatForJob.map((r) => {
    const local = localByCandidate.get(r.candidateId);
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
