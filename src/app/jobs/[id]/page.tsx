import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Users, Building2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  normalizeJob,
  flattenPipeline,
  type PipelineBucket,
  type RFJob,
} from "@/lib/recruiterflow";
import { getRfCandidatesForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getJobByIdentifier } from "@/lib/jobs";
import { getPlacementsForOrg } from "@/lib/placements";
import { JobPipelineSummary, type JobPipelineRow } from "@/app/jobs/[id]/pipeline-summary";
import { EditableJobDescription } from "@/app/jobs/[id]/editable-job-description";
import { prisma } from "@/lib/prisma";
import { cn, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: { id: string } }) {
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

  const counts = pipelineRows.reduce(
    (acc, r) => {
      if (r.bucket === "submitted") acc.submitted += 1;
      if (r.bucket === "interviewing") acc.interviewing += 1;
      if (r.bucket === "hired") acc.hired += 1;
      return acc;
    },
    { submitted: 0, interviewing: 0, hired: 0 },
  );

  const customFields = Array.isArray(raw.custom_fields) ? raw.custom_fields : [];
  const billingContact = customFields.find((f) => f.name?.toLowerCase() === "billing contact")?.value as string | undefined;
  const feePct = customFields.find((f) => f.name?.toLowerCase().includes("client fee"))?.value as number | undefined;
  const estFee = customFields.find((f) => f.name?.toLowerCase().includes("estimated fee") || f.name?.toLowerCase().includes("etimated fee"))?.value as number | undefined;

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
          clientSlug ? (
            <Link
              href={`/clients/${clientSlug}`}
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
          <DT label={isAceNative ? "Status" : "Status (RF)"} value={job.statusName || (job.isOpen ? "Active" : "Closed")} />
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
                // Pre-Phase-2 callers keyed on a single numeric jobRfId.
                // Ace-native Jobs carry legacyRfId null; pass 0 as a
                // sentinel and let write paths (placement-actions)
                // branch on jobCuid when present.
                jobRfId: rfId ?? 0,
                jobCuid: isAceNative ? jobRow.id : null,
                clientRfId: job.companyId ?? 0,
                clientCuid: jobRow.clientId ?? null,
                jobTitle: job.title,
                clientName: job.company || "",
              }}
            />
          </div>
        )}
      </div>

      <EditableJobDescription
        jobRfId={rfId}
        jobCuid={isAceNative ? jobRow.id : null}
        rfDescription={rfDescription}
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
