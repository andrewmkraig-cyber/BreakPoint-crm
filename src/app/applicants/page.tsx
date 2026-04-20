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

    // Disqualify a (candidate, job) pair from Applied if the recruiter has
    // already moved them PAST applied — submitted / interviewing / offer /
    // pending_start / hired / rejected / cancelled. A Placement at
    // stage="applied" is the canonical "lives here" signal and must NOT
    // hide the row (this was the Apply-button bug — Apply created the
    // Placement, the Placement disqualified the row, the row disappeared).
    // Same for "kept" — those go in the Kept tab below, not Applied.
    const HIDE_FROM_APPLIED: ReadonlySet<string> = new Set([
      "submitted",
      "interviewing",
      "offer",
      "pending_start",
      "hired",
      "rejected",
      "cancelled",
      "kept",
    ]);
    const placedPairsHidden = new Set<string>();
    const localApplied = new Map<string, (typeof placements)[number]>();
    for (const p of placements) {
      const key = `${p.candidateRfId}:${p.jobRfId}`;
      if (HIDE_FROM_APPLIED.has(p.stage)) {
        placedPairsHidden.add(key);
      } else if (p.stage === "applied") {
        localApplied.set(key, p);
      }
    }

    // RF-sourced applied rows: candidates whose RF stage_name canonicalizes
    // to "applied" and that haven't been moved past Applied locally.
    for (const c of candidates) {
      const jobs: RFCandidateJob[] = Array.isArray(c.jobs) ? c.jobs : [];
      const name =
        c.name ??
        [c.first_name, c.last_name].filter(Boolean).join(" ") ??
        "(unnamed)";
      for (const j of jobs) {
        if (typeof j?.job_id !== "number") continue;
        if (canonicalStage(j.stage_name) !== "applied") continue;
        if (placedPairsHidden.has(`${c.id}:${j.job_id}`)) continue;
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

    // Local-Placement applied rows: clicking Apply in Ace writes
    // Placement.stage="applied"; surface those even when RF still says
    // sourced (RF /external doesn't reliably accept stage moves, so we
    // can't rely on RF stage_name catching up). Dedupe against the RF
    // pass above by (candidateId, jobId).
    const seenAppliedKey = new Set<string>();
    for (const r of appliedRows) seenAppliedKey.add(`${r.candidateId}:${r.jobId}`);
    for (const [key, p] of Array.from(localApplied.entries())) {
      if (p.candidateRfId == null) continue;
      if (seenAppliedKey.has(key)) continue;
      const cand = candidateById.get(p.candidateRfId);
      const candJob = cand && Array.isArray(cand.jobs)
        ? (cand.jobs as RFCandidateJob[]).find((j) => j.job_id === p.jobRfId)
        : null;
      const candName =
        cand?.name ??
        [cand?.first_name, cand?.last_name].filter(Boolean).join(" ") ??
        "(unnamed)";
      appliedRows.push({
        candidateId: p.candidateRfId,
        candidateName: candName || "(unnamed)",
        jobId: p.jobRfId,
        jobTitle: candJob?.title ?? candJob?.name ?? "(untitled job)",
        clientRfId: p.clientRfId,
        clientName: candJob?.client_company_name ?? "",
        appliedAt: p.updatedAt.toISOString(),
        source: cand?.source_name ?? null,
      });
    }

    appliedRows.sort((a, b) => {
      const ta = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
      const tb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
      return tb - ta;
    });

    // Kept tab: local Placement rows with stage="kept". Enrich from RF
    // candidate+job data for display. Ace-local candidates (candidateRfId
    // null) aren't rendered here yet — the Kept tab is RF-scoped until the
    // local pipeline work lands.
    for (const p of placements) {
      if (p.stage !== "kept") continue;
      if (p.candidateRfId == null) continue;
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
