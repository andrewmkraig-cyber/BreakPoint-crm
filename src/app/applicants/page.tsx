import { PageHeader } from "@/components/page-header";
import {
  ApplicantsView,
  type AppliedRow,
  type KeptRow,
} from "@/app/applicants/applicants-view";
import { prisma } from "@/lib/prisma";
import {
  recruiterflow,
  canonicalStage,
  type RFCandidate,
  type RFCandidateJob,
} from "@/lib/recruiterflow";

export const dynamic = "force-dynamic";

export default async function ApplicantsPage() {
  const appliedRows: AppliedRow[] = [];
  const keptRows: KeptRow[] = [];
  let error: string | null = null;

  try {
    const [candidates, placements] = await Promise.all([
      recruiterflow.listAllCandidates({ perPage: 100 }),
      prisma.placement.findMany({
        where: { stage: { in: ["kept", "rejected", "offer", "pending_start", "hired", "cancelled", "submitted", "applied", "sourced"] } },
        select: {
          id: true,
          candidateRfId: true,
          jobRfId: true,
          clientRfId: true,
          stage: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const candidateById = new Map<number, RFCandidate>();
    for (const c of candidates) candidateById.set(c.id, c);

    // Any Placement row for a (candidate, job) pair disqualifies the pair from
    // the Applied tab — the recruiter has already taken action (submitted,
    // rejected, kept, etc.).
    const placedPairs = new Set<string>();
    for (const p of placements) placedPairs.add(`${p.candidateRfId}:${p.jobRfId}`);

    for (const c of candidates) {
      const jobs: RFCandidateJob[] = Array.isArray(c.jobs) ? c.jobs : [];
      const name =
        c.name ??
        [c.first_name, c.last_name].filter(Boolean).join(" ") ??
        "(unnamed)";
      for (const j of jobs) {
        if (typeof j?.job_id !== "number") continue;
        if (canonicalStage(j.stage_name) !== "applied") continue;
        if (placedPairs.has(`${c.id}:${j.job_id}`)) continue;
        appliedRows.push({
          candidateId: c.id,
          candidateName: name || "(unnamed)",
          jobId: j.job_id,
          jobTitle: j.title ?? j.name ?? "(untitled job)",
          clientRfId: j.client_company_id ?? 0,
          clientName: j.client_company_name ?? "",
          appliedAt: j.stage_moved ?? j.added_time ?? c.added_time ?? null,
          source: c.source_name ?? null,
        });
      }
    }

    appliedRows.sort((a, b) => {
      const ta = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
      const tb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
      return tb - ta;
    });

    // Kept tab: local Placement rows with stage="kept". Enrich from RF
    // candidate+job data for display.
    for (const p of placements) {
      if (p.stage !== "kept") continue;
      const cand = candidateById.get(p.candidateRfId);
      const candName =
        cand?.name ??
        [cand?.first_name, cand?.last_name].filter(Boolean).join(" ") ??
        "(unnamed)";
      const candJob = cand && Array.isArray(cand.jobs)
        ? (cand.jobs as RFCandidateJob[]).find((j) => j.job_id === p.jobRfId)
        : null;
      keptRows.push({
        candidateId: p.candidateRfId,
        candidateName: candName || "(unnamed)",
        jobId: p.jobRfId,
        jobTitle: candJob?.title ?? candJob?.name ?? "(untitled job)",
        clientRfId: p.clientRfId,
        clientName: candJob?.client_company_name ?? "",
        keptAt: p.updatedAt.toISOString(),
      });
    }
    keptRows.sort((a, b) => new Date(b.keptAt).getTime() - new Date(a.keptAt).getTime());
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load applicants.";
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Inbound"
        title="Applicants"
        description="Candidates who applied directly to your open jobs. Submit, Reject, or Keep each for follow-up."
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load applicants.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <ApplicantsView applied={appliedRows} kept={keptRows} />
    </div>
  );
}
