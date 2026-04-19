import { PageHeader } from "@/components/page-header";
import { PipelineView, type NextInterview, type PipelineRow, type PlacementDetails } from "@/app/pipeline/pipeline-view";
import { prisma } from "@/lib/prisma";
import {
  recruiterflow,
  flattenPipeline,
  PIPELINE_LABELS,
  daysBetween,
  type PipelineBucket,
} from "@/lib/recruiterflow";

export const dynamic = "force-dynamic";

type Stage = keyof typeof PIPELINE_LABELS;
const STAGES: Stage[] = ["submitted", "interviewing", "offer", "pending_start", "hired"];

const PAGE_SIZE = 25;

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: { stage?: string; q?: string; page?: string };
}) {
  const stage: Stage = (STAGES as string[]).includes(searchParams?.stage ?? "")
    ? (searchParams!.stage as Stage)
    : "submitted";
  const q = (searchParams?.q ?? "").trim();
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
    const [candidates, placements, interviews] = await Promise.all([
      recruiterflow.listAllCandidates({ perPage: 100 }),
      prisma.placement.findMany(),
      prisma.interview.findMany({
        where: { status: "scheduled", scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        select: { candidateRfId: true, jobRfId: true, scheduledAt: true, type: true },
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

    const placementByKey = new Map<string, (typeof placements)[number]>();
    for (const p of placements) {
      placementByKey.set(`${p.candidateRfId}:${p.jobRfId}`, p);
    }

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

    // Local placements win over RF's stage_name because Ace drove the move.
    const seen = new Set<string>();
    const allRows: PipelineRow[] = [];

    for (const p of placements) {
      // Cancelled placements are excluded from the pipeline view entirely.
      if (p.stage === "cancelled") continue;
      const key = `${p.candidateRfId}:${p.jobRfId}`;
      seen.add(key);
      const rfEntry = flat.find(
        (r) => r.candidateId === p.candidateRfId && r.jobId === p.jobRfId,
      );
      const stageName = p.stage as Stage;
      if (!(stageName in counts)) continue;
      // Pipeline rows are RF-scoped for now; Ace-local candidates use the
      // local profile's own action list. Skip until a unified view lands.
      if (p.candidateRfId == null) continue;
      counts[stageName] += 1;
      allRows.push({
        candidateId: p.candidateRfId,
        candidateName: candidateNameById.get(p.candidateRfId) ?? rfEntry?.candidateName ?? "(unknown)",
        candidateTitle: rfEntry?.candidateTitle ?? "",
        jobId: p.jobRfId,
        jobTitle: rfEntry?.jobTitle ?? "",
        clientName: rfEntry?.clientName ?? "",
        stageName: PIPELINE_LABELS[stageName as keyof typeof PIPELINE_LABELS] ?? p.stage,
        bucket: stageName,
        lastActionAt: p.updatedAt.toISOString(),
        daysInStage: daysBetween(p.updatedAt.toISOString()),
        isKept: rfEntry?.isKept ?? false,
        placement: toPlacementDetails(p),
        nextInterview: nextByKey.get(`${p.candidateRfId}:${p.jobRfId}`) ?? null,
      });
    }

    for (const r of flat) {
      if (!isPipelineStage(r.bucket)) continue;
      const key = `${r.candidateId}:${r.jobId}`;
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
