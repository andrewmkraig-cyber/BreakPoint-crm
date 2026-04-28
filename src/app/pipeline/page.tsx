import { PageHeader } from "@/components/page-header";
import { PipelineView, type NextInterview, type PipelineRow, type PlacementDetails } from "@/app/pipeline/pipeline-view";
import { prisma } from "@/lib/prisma";
import {
  flattenPipeline,
  PIPELINE_LABELS,
  daysBetween,
  type PipelineBucket,
} from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg } from "@/lib/candidates";
import { getPlacementsForOrg } from "@/lib/placements";
import { getInterviewsForOrg } from "@/lib/interviews";

export const dynamic = "force-dynamic";

type Stage = keyof typeof PIPELINE_LABELS;
const STAGES: Stage[] = ["submitted", "interviewing", "offer", "pending_start", "hired"];

const PAGE_SIZE = 25;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { stage?: string; q?: string; page?: string; clientId?: string; jobId?: string };
}) {
  const stage: Stage = (STAGES as string[]).includes(searchParams?.stage ?? "")
    ? (searchParams!.stage as Stage)
    : "submitted";
  const q = (searchParams?.q ?? "").trim();
  // ?clientId=<cuid> filter — emitted by the client detail page's clickable
  // stat strip. When set, only Placement-rooted rows whose Placement.clientId
  // matches survive; the RF-flat-pipeline rows are dropped because they
  // aren't tracked in Neon Placement (consistent with how the client detail
  // counters compute, so the per-client counts match end-to-end).
  const clientFilter = searchParams?.clientId?.trim() || null;
  // ?jobId=<rfNumeric> filter — emitted by the per-job stage pills in the
  // client detail Jobs table. Job rows there iterate raw.open_jobs /
  // raw.closed_jobs, both keyed by the RF numeric id, so jobId here is
  // matched against Placement.jobRfId. RF-flat rows are skipped when set
  // (same rationale as the clientId filter — those rows aren't in Neon).
  const jobIdRaw = searchParams?.jobId?.trim();
  const jobFilter = jobIdRaw && /^\d+$/.test(jobIdRaw) ? Number(jobIdRaw) : null;
  const pageParam = parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  let rows: PipelineRow[] = [];
  const counts: Record<Stage, number> = {
    submitted: 0,
    interviewing: 0,
    offer: 0,
    pending_start: 0,
    hired: 0,
  };
  let error: string | null = null;

  try {
    // Phase 4a: Placement + Interview reads routed through the tenant-
    // scoped helpers. The pipeline view is global to the signed-in org
    // (no per-candidate filter) so the helpers are called with just the
    // filters this page cares about.
    const [candidates, placements, interviews] = await Promise.all([
      getRfCandidatesForOrg(),
      getPlacementsForOrg(),
      getInterviewsForOrg({
        statuses: ["scheduled"],
        scheduledAfter: new Date(),
      }),
    ]);

    // (candidateRfId, jobRfId) -> earliest upcoming interview
    const nextByKey = new Map<string, NextInterview>();
    for (const iv of interviews) {
      if (iv.candidateRfId == null) continue;
      const key = `${iv.candidateRfId}:${iv.jobRfId}`;
      if (nextByKey.has(key)) continue; // first match wins (orderBy asc)
      nextByKey.set(key, {
        scheduledAt: iv.scheduledAt.toISOString(),
        type: iv.type as NextInterview["type"],
      });
    }

    // Phase 4b: key on whichever identity the placement carries — RF
    // numeric for imported rows, cuid for Ace-native. Keeps the dedupe
    // below honest across both shapes (the flat-pipeline loop emits
    // RF-keyed entries; Ace-native rows only come from Placements).
    const placementKey = (p: {
      candidateRfId: number | null;
      candidateId: string | null;
      jobRfId: number | null;
      jobId: string | null;
    }) => {
      const cid = p.candidateRfId != null ? `rf:${p.candidateRfId}` : `ace:${p.candidateId ?? "?"}`;
      const jid = p.jobRfId != null ? `rf:${p.jobRfId}` : `ace:${p.jobId ?? "?"}`;
      return `${cid}|${jid}`;
    };
    const placementByKey = new Map<string, (typeof placements)[number]>();
    for (const p of placements) placementByKey.set(placementKey(p), p);

    const flat = flattenPipeline(candidates);
    const candidateNameById = new Map<number, string>();
    for (const c of candidates) {
      candidateNameById.set(
        c.id,
        c.name ??
          [c.first_name, c.last_name].filter(Boolean).join(" ") ??
          "(unnamed)",
      );
    }

    // Ace-native candidate + job lookups for rows that carry cuid
    // identities. Batched once so we don't per-row round-trip Neon.
    const aceCandidateIds = new Set<string>();
    const aceJobIds = new Set<string>();
    for (const p of placements) {
      if (p.candidateRfId == null && p.candidateId) aceCandidateIds.add(p.candidateId);
      if (p.jobRfId == null && p.jobId) aceJobIds.add(p.jobId);
    }
    const [aceCandidates, aceJobs] = await Promise.all([
      aceCandidateIds.size > 0
        ? prisma.candidate.findMany({
            where: { id: { in: Array.from(aceCandidateIds) } },
            select: { id: true, firstName: true, lastName: true, currentDesignation: true },
          })
        : Promise.resolve([]),
      aceJobIds.size > 0
        ? prisma.job.findMany({
            where: { id: { in: Array.from(aceJobIds) } },
            select: { id: true, title: true, client: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);
    const aceCandidateById = new Map(aceCandidates.map((c) => [c.id, c]));
    const aceJobById = new Map(aceJobs.map((j) => [j.id, j]));

    // Local placements win over RF's stage_name because Ace drove the move.
    const seen = new Set<string>();
    const allRows: PipelineRow[] = [];

    for (const p of placements) {
      // Cancelled placements are excluded from the pipeline view entirely.
      if (p.stage === "cancelled") continue;
      // Per-client filter: drop placements whose clientId doesn't match.
      // Skipped via early-continue so neither counts nor rows include them.
      if (clientFilter && p.clientId !== clientFilter) continue;
      // Per-job filter: same pattern, matching Placement.jobRfId against
      // the numeric id passed from the per-row pills on the client page.
      if (jobFilter !== null && p.jobRfId !== jobFilter) continue;
      const key = placementKey(p);
      seen.add(key);
      const stageName = p.stage as Stage;
      if (!(stageName in counts)) continue;
      counts[stageName] += 1;

      // Pick the identity fields — numeric RF for imported, cuid for
      // Ace-native. Ace-native rows can't match flat-pipeline entries
      // (those only come from RFCandidate.jobs[], which is RF-scoped).
      const isRfCandidate = p.candidateRfId != null;
      const isRfJob = p.jobRfId != null;
      const candidateId: number | string = isRfCandidate ? p.candidateRfId! : p.candidateId!;
      const jobId: number | string = isRfJob ? p.jobRfId! : p.jobId!;
      const rfEntry = isRfCandidate && isRfJob
        ? flat.find((r) => r.candidateId === p.candidateRfId && r.jobId === p.jobRfId)
        : null;

      const aceCandidate = !isRfCandidate && p.candidateId ? aceCandidateById.get(p.candidateId) : null;
      const aceJob = !isRfJob && p.jobId ? aceJobById.get(p.jobId) : null;

      const candidateName = isRfCandidate
        ? candidateNameById.get(p.candidateRfId!) ?? rfEntry?.candidateName ?? "(unknown)"
        : aceCandidate
          ? [aceCandidate.firstName, aceCandidate.lastName].filter(Boolean).join(" ") || "(unnamed)"
          : "(unknown)";
      const candidateTitle = isRfCandidate ? rfEntry?.candidateTitle ?? "" : aceCandidate?.currentDesignation ?? "";
      const jobTitle = isRfJob ? rfEntry?.jobTitle ?? "" : aceJob?.title ?? "";
      const clientName = isRfJob ? rfEntry?.clientName ?? "" : aceJob?.client?.name ?? "";

      allRows.push({
        candidateId,
        candidateName,
        candidateTitle,
        jobId,
        jobTitle,
        clientName,
        stageName: PIPELINE_LABELS[stageName as keyof typeof PIPELINE_LABELS] ?? p.stage,
        bucket: stageName,
        lastActionAt: p.updatedAt.toISOString(),
        daysInStage: daysBetween(p.updatedAt.toISOString()),
        isKept: rfEntry?.isKept ?? false,
        placement: toPlacementDetails(p),
        nextInterview: isRfCandidate && isRfJob
          ? nextByKey.get(`${p.candidateRfId}:${p.jobRfId}`) ?? null
          : null,
      });
    }

    for (const r of flat) {
      if (!isPipelineStage(r.bucket)) continue;
      // When a clientId or jobId filter is active, RF-flat rows are
      // excluded entirely (they aren't tracked in Neon Placement so we
      // can't verify their client/job linkage; counts on the client
      // detail page come from Placement only, so this keeps the math
      // consistent).
      if (clientFilter || jobFilter !== null) continue;
      // flat entries are always RF numeric on both sides.
      const key = `rf:${r.candidateId}|rf:${r.jobId}`;
      if (seen.has(key)) continue;
      counts[r.bucket] += 1;
      allRows.push({
        candidateId: r.candidateId,
        candidateName: r.candidateName,
        candidateTitle: r.candidateTitle,
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        clientName: r.clientName,
        stageName: r.stageName,
        bucket: r.bucket,
        lastActionAt: r.stageMovedAt,
        daysInStage: daysBetween(r.stageMovedAt),
        isKept: r.isKept,
        placement: null,
        nextInterview: nextByKey.get(`${r.candidateId}:${r.jobId}`) ?? null,
      });
    }

    rows = allRows.filter((r) => r.bucket === stage);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to fetch pipeline";
  }

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.candidateName.toLowerCase().includes(needle) ||
        r.jobTitle.toLowerCase().includes(needle) ||
        r.clientName.toLowerCase().includes(needle),
    );
  }

  if (stage === "pending_start") {
    rows.sort((a, b) => {
      const ta = a.placement?.expectedStartDate ? new Date(a.placement.expectedStartDate).getTime() : Infinity;
      const tb = b.placement?.expectedStartDate ? new Date(b.placement.expectedStartDate).getTime() : Infinity;
      return ta - tb;
    });
  } else {
    rows.sort((a, b) => {
      const ta = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
      const tb = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
      return tb - ta;
    });
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Every active submittal across your open jobs. One row per candidate-per-job. Kept candidates are tagged, not bucketed as their own stage."
      />
      <PipelineView
        rows={pageRows}
        total={total}
        page={safePage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        stage={stage}
        q={q}
        counts={counts}
        error={error}
      />
    </div>
  );
}

type PlacementRow = Awaited<ReturnType<typeof prisma.placement.findMany>>[number];

function toPlacementDetails(p: PlacementRow): PlacementDetails {
  return {
    id: p.id,
    stage: p.stage as "offer" | "pending_start" | "hired",
    syncedToRf: p.syncedToRf,
    acceptedSalary: p.acceptedSalary,
    acceptedCurrency: p.acceptedCurrency,
    feePercentage: p.feePercentage,
    feeTotal: p.feeTotal,
    billingContactName: p.billingContactName,
    billingContactEmail: p.billingContactEmail,
    expectedStartDate: p.expectedStartDate?.toISOString() ?? null,
    startConfirmedAt: p.startConfirmedAt?.toISOString() ?? null,
    invoicingFlagged: p.invoicingFlagged,
  };
}

function isPipelineStage(b: PipelineBucket): b is Stage {
  return b === "submitted" || b === "interviewing" || b === "offer" || b === "pending_start" || b === "hired";
}
