import { PageHeader } from "@/components/page-header";
import { ApplicantsView, type ApplicantRow } from "@/app/applicants/applicants-view";
import { prisma } from "@/lib/prisma";
import {
  recruiterflow,
  canonicalStage,
  type RFCandidateJob,
} from "@/lib/recruiterflow";
import type { ApplicantStatusValue } from "@/app/applicants/actions";

export const dynamic = "force-dynamic";

const VALID_STATUS: ReadonlySet<ApplicantStatusValue> = new Set<ApplicantStatusValue>([
  "new",
  "reviewed",
  "rejected",
  "moved_to_pipeline",
]);

export default async function ApplicantsPage() {
  const rows: ApplicantRow[] = [];
  let error: string | null = null;

  try {
    const [candidates, actionLogs] = await Promise.all([
      recruiterflow.listAllCandidates({ perPage: 100 }),
      prisma.actionLog.findMany({
        where: { subjectType: "candidate", actionType: "applicant_status" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Latest applicant_status per candidate+job pair.
    const statusByPair = new Map<string, ApplicantStatusValue>();
    for (const log of actionLogs) {
      const meta = log.metadata as { jobRfId?: number; status?: string } | null;
      if (!meta || typeof meta.jobRfId !== "number" || typeof meta.status !== "string") continue;
      if (!VALID_STATUS.has(meta.status as ApplicantStatusValue)) continue;
      const key = `${log.subjectId}:${meta.jobRfId}`;
      if (!statusByPair.has(key)) statusByPair.set(key, meta.status as ApplicantStatusValue);
    }

    for (const c of candidates) {
      const jobs: RFCandidateJob[] = Array.isArray(c.jobs) ? c.jobs : [];
      const name =
        c.name ??
        [c.first_name, c.last_name].filter(Boolean).join(" ") ??
        "(unnamed)";
      for (const j of jobs) {
        if (typeof j?.job_id !== "number") continue;
        if (canonicalStage(j.stage_name) !== "applied") continue;
        const key = `${c.id}:${j.job_id}`;
        const status = statusByPair.get(key) ?? "new";
        rows.push({
          candidateId: c.id,
          candidateName: name || "(unnamed)",
          jobId: j.job_id,
          jobTitle: j.title ?? j.name ?? "(untitled job)",
          clientName: j.client_company_name ?? "",
          appliedAt: j.stage_moved ?? j.added_time ?? c.added_time ?? null,
          source: c.source_name ?? null,
          status,
        });
      }
    }

    rows.sort((a, b) => {
      const ta = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
      const tb = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
      return tb - ta;
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load applicants.";
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Inbound"
        title="Applicants"
        description="Candidates who've applied directly to your open jobs. Move them into the Pipeline once you've reviewed."
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Couldn&apos;t load applicants from RecruiterFlow.</div>
          <div className="mt-1 font-mono text-xs">{error}</div>
        </div>
      )}

      <ApplicantsView rows={rows} />
    </div>
  );
}
