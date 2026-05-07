import { PageHeader } from "@/components/page-header";
import {
  ApplicantsView,
  type AppliedRow,
  type KeptRow,
} from "@/app/applicants/applicants-view";
import { prisma } from "@/lib/prisma";
import {
  canonicalStage,
  normalizeJob,
  type RFCandidate,
  type RFCandidateJob,
  type RFJob,
} from "@/lib/rf-payload-shapes";
import { getRfCandidatesForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { getPlacementsForOrg } from "@/lib/placements";
import { resolveJobTitle } from "@/lib/job-title";

export const dynamic = "force-dynamic";

export default async function ApplicantsPage() {
  const appliedRows: AppliedRow[] = [];
  const keptRows: KeptRow[] = [];
  let error: string | null = null;

  try {
    const [candidates, placements, allJobs, jobOverrides] = await Promise.all([
      getRfCandidatesForOrg(),
      // Phase 4a: the Placement read routes through the tenant-scoped
      // helper with the applicants page's stage filter. The helper
      // returns full rows (no select projection); every column the
      // renderer reads below lives on the Placement model.
      getPlacementsForOrg({
        stages: [
          "kept",
          "rejected",
          "offer",
          "pending_start",
          "hired",
          "cancelled",
          "submitted",
          "applied",
          "sourced",
        ],
      }),
      // Pull the full job list so we can resolve each row's title /
      // location. The RFCandidateJob rows hanging off c.jobs are sparse
      // (often title-only with no location) — the canonical Job record
      // has the full data we want for the Applicants table. Reads from
      // Neon now so the page renders even when RF is unreachable.
      getRfJobsForOrg(),
      prisma.jobOverride.findMany({ select: { jobRfId: true, title: true } }),
    ]);

    const candidateById = new Map<number, RFCandidate>();
    for (const c of candidates) candidateById.set(c.id, c);
    const jobById = new Map<number, RFJob>();
    for (const j of allJobs) jobById.set(j.id, j);
    const overrideByJob = new Map<number, { title: string | null }>();
    for (const o of jobOverrides) overrideByJob.set(o.jobRfId, { title: o.title });

    const describeJob = (jobId: number | null, fallbackJob?: RFCandidateJob): { title: string; location: string; clientName: string } => {
      if (jobId == null) {
        return { title: "(job)", location: "", clientName: "" };
      }
      const rfJob = jobById.get(jobId) ?? null;
      const normalized = rfJob ? normalizeJob(rfJob) : null;
      const title = resolveJobTitle({
        override: overrideByJob.get(jobId) ?? null,
        // Pass both the canonical RFJob AND the sparse RFCandidateJob so
        // the resolver can grab a title from whichever source has one.
        // Most RF imports populate `name` on the canonical record but
        // leave `title` empty; some do the opposite on the candidate-job
        // join.
        job: { ...(rfJob ?? {}), ...(fallbackJob ?? {}) },
      });
      const location = normalized?.location ?? "";
      const clientName = normalized?.company ?? fallbackJob?.client_company_name ?? "";
      return { title, location, clientName };
    };

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

    // Keys are discriminated so rf vs ace rows never collide. RF key uses
    // the numeric candidateRfId; Ace key uses the cuid. A Placement with
    // neither key set is impossible given the app-layer XOR invariant.
    // Phase 2: jobRfId / jobId are both nullable on Placement now. Pick
    // whichever identity is set to build a dedupe key — the two shapes
    // never collide because rf: prefixes one namespace and ace: the
    // other. Placements with neither key would be DB corruption; render
    // them under "?" so they're visible rather than silently dropped.
    const placementKey = (p: {
      candidateRfId: number | null;
      candidateId: string | null;
      jobRfId: number | null;
      jobId: string | null;
    }) => {
      const jobKey = p.jobRfId != null ? String(p.jobRfId) : p.jobId ?? "?";
      return p.candidateRfId != null
        ? `rf:${p.candidateRfId}:${jobKey}`
        : `ace:${p.candidateId ?? "?"}:${jobKey}`;
    };

    const placedPairsHidden = new Set<string>();
    const localApplied = new Map<string, (typeof placements)[number]>();
    for (const p of placements) {
      const key = placementKey(p);
      if (HIDE_FROM_APPLIED.has(p.stage)) {
        placedPairsHidden.add(key);
      } else if (p.stage === "applied") {
        localApplied.set(key, p);
      }
    }

    // Batch-fetch Neon Candidate rows for every Ace-native candidateId
    // referenced by an Applied or Kept Placement. Lookup map powers the
    // name / title rendering for the rows the legacy skip-gates used to
    // drop.
    const aceCandidateIds = new Set<string>();
    for (const p of placements) {
      if (p.candidateRfId == null && p.candidateId) aceCandidateIds.add(p.candidateId);
    }
    const aceCandidates = aceCandidateIds.size > 0
      ? await prisma.candidate.findMany({
          where: { id: { in: Array.from(aceCandidateIds) } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            currentDesignation: true,
            createdAt: true,
          },
        })
      : [];
    const aceById = new Map(aceCandidates.map((c) => [c.id, c]));

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
        const desc = describeJob(j.job_id, j);
        appliedRows.push({
          candidateId: c.id,
          candidateName: name || "(unnamed)",
          jobId: j.job_id,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: j.client_company_id ?? 0,
          clientName: desc.clientName,
          appliedAt: j.stage_moved ?? j.added_time ?? c.added_time ?? null,
          source: c.source_name ?? null,
        });
      }
    }

    // Local-Placement applied rows: clicking Apply in Ace writes
    // Placement.stage="applied"; surface those even when RF still says
    // sourced (RF /external doesn't reliably accept stage moves, so we
    // can't rely on RF stage_name catching up). Two row shapes come out
    // of the same table — RF-imported rows (candidateRfId set) and
    // Ace-native rows (candidateId set, candidateRfId null). The skip
    // gate that used to drop Ace-native rows has been removed; the
    // dedupe keys use the same rf/ace discriminator as placementKey so
    // the two shapes never collide on the RF numeric id.
    const seenAppliedKey = new Set<string>();
    for (const r of appliedRows) seenAppliedKey.add(`rf:${r.candidateId}:${r.jobId}`);
    for (const [key, p] of Array.from(localApplied.entries())) {
      if (seenAppliedKey.has(key)) continue;
      // Pick whichever identity the placement row carries. Ace-native
      // Jobs come back with jobId (cuid); RF-imported jobs with jobRfId.
      // The table renders either via AppliedRow.jobId: number | string
      // and the /jobs/[id] route resolves either via getJobByIdentifier.
      const rowJobId: number | string = p.jobRfId != null ? p.jobRfId : p.jobId ?? "";
      if (p.candidateRfId != null) {
        const cand = candidateById.get(p.candidateRfId);
        const candJob = cand && Array.isArray(cand.jobs)
          ? (cand.jobs as RFCandidateJob[]).find((j) => j.job_id === p.jobRfId)
          : null;
        const candName =
          cand?.name ??
          [cand?.first_name, cand?.last_name].filter(Boolean).join(" ") ??
          "(unnamed)";
        const desc = describeJob(p.jobRfId, candJob ?? undefined);
        appliedRows.push({
          candidateId: p.candidateRfId,
          candidateName: candName || "(unnamed)",
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          appliedAt: p.updatedAt.toISOString(),
          // Local Placement carries its own source (e.g.
          // "recruiter_applied" stamped by applyCandidateToJob from the
          // PlacementActions UI). Falls back to RF's candidate-level
          // source_name if the local row was older than the source field.
          source: p.source ?? cand?.source_name ?? null,
        });
        continue;
      }
      // Ace-native applied row. Name / title come from the Neon Candidate
      // row we batch-fetched up top. No RF candidate to cross-reference,
      // and c.jobs[] doesn't apply — just render the Placement directly.
      if (p.candidateId) {
        const ace = aceById.get(p.candidateId);
        const aceName = ace
          ? [ace.firstName, ace.lastName].filter(Boolean).join(" ") || "(unnamed)"
          : "(unnamed)";
        const desc = describeJob(p.jobRfId);
        appliedRows.push({
          candidateId: p.candidateId,
          candidateName: aceName,
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          appliedAt: p.updatedAt.toISOString(),
          source: p.source ?? null,
        });
      }
    }

    appliedRows.sort((a, b) => {
      const ta = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
      const tb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
      return tb - ta;
    });

    // Kept tab: local Placement rows with stage="kept". Handles both
    // RF-imported (candidateRfId) and Ace-native (candidateId) rows.
    // Symmetric with the Applied assembly above — dropped the null-skip
    // gate so Ace-native Kept rows show up here too.
    for (const p of placements) {
      if (p.stage !== "kept") continue;
      const rowJobId: number | string = p.jobRfId != null ? p.jobRfId : p.jobId ?? "";
      if (p.candidateRfId != null) {
        const cand = candidateById.get(p.candidateRfId);
        const candName =
          cand?.name ??
          [cand?.first_name, cand?.last_name].filter(Boolean).join(" ") ??
          "(unnamed)";
        const candJob = cand && Array.isArray(cand.jobs)
          ? (cand.jobs as RFCandidateJob[]).find((j) => j.job_id === p.jobRfId)
          : null;
        const desc = describeJob(p.jobRfId, candJob ?? undefined);
        keptRows.push({
          candidateId: p.candidateRfId,
          candidateName: candName || "(unnamed)",
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          keptAt: p.updatedAt.toISOString(),
        });
        continue;
      }
      if (p.candidateId) {
        const ace = aceById.get(p.candidateId);
        const aceName = ace
          ? [ace.firstName, ace.lastName].filter(Boolean).join(" ") || "(unnamed)"
          : "(unnamed)";
        const desc = describeJob(p.jobRfId);
        keptRows.push({
          candidateId: p.candidateId,
          candidateName: aceName,
          jobId: rowJobId,
          jobTitle: desc.title,
          jobLocation: desc.location,
          clientRfId: p.clientRfId,
          clientName: desc.clientName,
          keptAt: p.updatedAt.toISOString(),
        });
      }
    }
    keptRows.sort((a, b) => new Date(b.keptAt).getTime() - new Date(a.keptAt).getTime());
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load applicants.";
  }

  return (
    <div className="space-y-4">
      <PageHeader
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
