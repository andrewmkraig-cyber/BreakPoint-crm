import { PageHeader } from "@/components/page-header";
import { InboxView, type InboxRow } from "@/app/inbox/inbox-view";
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

export default async function InboxPage({
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

  let rows: InboxRow[] = [];
  const counts: Record<Stage, number> = {
    submitted: 0,
    interviewing: 0,
    offer: 0,
    pending_start: 0,
    hired: 0,
  };
  let error: string | null = null;

  try {
    const candidates = await recruiterflow.listAllCandidates({ perPage: 100 });
    const flat = flattenPipeline(candidates);
    const inPipeline = flat.filter((r) => isPipelineStage(r.bucket));

    for (const r of inPipeline) {
      counts[r.bucket as Stage] += 1;
    }

    rows = inPipeline
      .filter((r) => r.bucket === stage)
      .map<InboxRow>((r) => ({
        candidateId: r.candidateId,
        candidateName: r.candidateName,
        candidateTitle: r.candidateTitle,
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        clientName: r.clientName,
        stageName: r.stageName,
        bucket: r.bucket as Stage,
        lastActionAt: r.stageMovedAt,
        daysInStage: daysBetween(r.stageMovedAt),
        isKept: r.isKept,
      }));
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

  rows.sort((a, b) => {
    const ta = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
    const tb = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
    return tb - ta;
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        eyebrow="Pipeline"
        title="Inbox"
        description="Every active submittal across your open jobs. One row per candidate-per-job. Kept candidates are tagged, not bucketed as their own stage."
      />
      <InboxView
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

function isPipelineStage(b: PipelineBucket): b is Stage {
  return b === "submitted" || b === "interviewing" || b === "offer" || b === "pending_start" || b === "hired";
}
