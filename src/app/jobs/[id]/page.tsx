import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, MapPin, Users, Building2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  recruiterflow,
  normalizeJob,
  buildJobCounts,
  emptyJobCounts,
  flattenPipeline,
  canonicalStage,
  PIPELINE_LABELS,
} from "@/lib/recruiterflow";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [jobs, candidates] = await Promise.all([
    recruiterflow.listAllJobs({ perPage: 100 }),
    recruiterflow.listAllCandidates({ perPage: 100 }),
  ]);
  const raw = jobs.find((j) => j.id === id);
  if (!raw) notFound();

  const job = normalizeJob(raw);
  const counts = buildJobCounts(candidates).get(id) ?? emptyJobCounts();
  const submittalRows = flattenPipeline(candidates).filter((r) => r.jobId === id);

  const billingContact = raw.custom_fields?.find((f) => f.name?.toLowerCase() === "billing contact")?.value as string | undefined;
  const feePct = raw.custom_fields?.find((f) => f.name?.toLowerCase().includes("client fee"))?.value as number | undefined;
  const estFee = raw.custom_fields?.find((f) => f.name?.toLowerCase().includes("estimated fee") || f.name?.toLowerCase().includes("etimated fee"))?.value as number | undefined;

  return (
    <div className="space-y-6">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy"
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
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
            >
              <Building2 className="h-3 w-3" /> Client profile
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status" value={job.isOpen ? "Active" : "Inactive"} tone={job.isOpen ? "green" : "muted"} />
        <Stat label="Submitted" value={counts.submitted} />
        <Stat label="Interviewing" value={counts.interviewing} />
        <Stat label="Hired" value={counts.hired} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="font-serif text-lg font-semibold text-navy">Overview</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <DT label="Compensation" value={job.compensation || "—"} />
            <DT label="Openings" value={String(job.openings ?? "—")} />
            <DT label="Location" value={job.location || "—"} icon={<MapPin className="h-3 w-3" />} />
            <DT label="Job Type" value={[job.jobType, job.employmentType].filter(Boolean).join(" · ") || "—"} />
            <DT label="Status (RF)" value={job.statusName || (job.isOpen ? "Active" : "Closed")} />
            <DT label="Last Edited" value={job.lastEditedAt ? new Date(job.lastEditedAt).toLocaleString() : "—"} />
            <DT label="Billing Contact" value={billingContact || "—"} />
            <DT label="Fee" value={feePct ? `${feePct}%${estFee ? ` (est. $${estFee.toLocaleString()})` : ""}` : "—"} />
          </dl>
          {raw.apply_link && (
            <div className="mt-5 border-t border-border pt-4">
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

        <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <h2 className="font-serif text-lg font-semibold text-navy">Hiring Team</h2>
          {Array.isArray(raw.hiring_team) && raw.hiring_team.length > 0 ? (
            <ul className="mt-4 space-y-3 text-sm">
              {raw.hiring_team.map((u) => (
                <li key={u.id} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-dark">
                    {initials(u.name ?? `${u.first_name ?? ""} ${u.last_name ?? ""}`)}
                  </div>
                  <div>
                    <div className="font-medium text-navy">{u.name ?? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim()}</div>
                    <div className="text-xs text-muted-foreground">{u.role ?? "—"}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No one assigned.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-serif text-lg font-semibold text-navy">Pipeline</h2>
          <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            {submittalRows.length} {submittalRows.length === 1 ? "candidate" : "candidates"}
          </div>
        </div>
        {submittalRows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No candidates have been added to this job yet.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Candidate</th>
                <th className="px-5 py-3 font-medium">Stage</th>
                <th className="px-5 py-3 font-medium">Last Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {submittalRows.map((r) => (
                <tr key={`${r.candidateId}-${r.jobId}`} className="transition hover:bg-brand-tint/40">
                  <td className="px-5 py-3">
                    <Link href={`/candidates/${r.candidateId}`} className="font-medium text-navy hover:text-brand-dark">
                      {r.candidateName}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.candidateTitle || "—"}</div>
                  </td>
                  <td className="px-5 py-3">
                    <StageChip stageName={r.stageName} />
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {r.stageMovedAt ? new Date(r.stageMovedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-border bg-muted/40 p-5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-navy-400">
          <Briefcase className="h-3 w-3" /> Full job detail (activity, JD, submittal flow) arrives with the candidate profile work.
        </div>
      </div>
    </div>
  );
}

function DT({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 inline-flex items-center gap-1 text-navy">
        {icon}
        {value}
      </dd>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" | "muted" }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-serif text-2xl font-semibold",
          tone === "green" ? "text-brand-dark" : tone === "muted" ? "text-muted-foreground" : "text-navy",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StageChip({ stageName }: { stageName: string }) {
  const bucket = canonicalStage(stageName);
  const label = (bucket in PIPELINE_LABELS
    ? PIPELINE_LABELS[bucket as keyof typeof PIPELINE_LABELS]
    : stageName) || "—";
  const cls = {
    submitted: "bg-brand-tint text-brand-dark",
    interviewing: "bg-blue-50 text-blue-700",
    offer: "bg-amber-50 text-amber-700",
    pending_start: "bg-purple-50 text-purple-700",
    hired: "bg-emerald-50 text-emerald-700",
    sourced: "bg-muted text-navy-400",
    rejected: "bg-red-50 text-red-700",
    other: "bg-muted text-navy-400",
  }[bucket];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>
      {stageName || label}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}
