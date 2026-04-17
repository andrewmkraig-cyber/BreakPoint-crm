import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  ExternalLink,
  FileText,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import {
  recruiterflow,
  canonicalStage,
  normalizeClient,
  PIPELINE_LABELS,
  daysBetween,
  type RFCandidate,
  type RFFile,
  type RFCandidateJob,
} from "@/lib/recruiterflow";
import { EditableContact, type ContactState } from "@/app/candidates/[id]/editable-contact";
import { EditableEmployment, type EmploymentState } from "@/app/candidates/[id]/editable-employment";
import { EditableSkills } from "@/app/candidates/[id]/editable-skills";
import { EditableNotes, type NoteRow } from "@/app/candidates/[id]/editable-notes";
import { EditableExperience, type ExperienceRow } from "@/app/candidates/[id]/editable-experience";
import { EditableEducation, type EducationRow } from "@/app/candidates/[id]/editable-education";
import {
  PlacementActions,
  type PlacementContextJob,
  type PlacementSnapshot,
} from "@/app/candidates/[id]/placement-flows";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ExperienceRaw = {
  designation?: string | null;
  organization?: string | null;
  description?: string | null;
  from?: [number | null, number | null];
  to?: [number | null, number | null];
};

type EducationRaw = {
  school?: string | null;
  degree?: string | null;
  description?: string | null;
  from?: [number | null, number | null];
  to?: [number | null, number | null];
};

type NoteRaw = { id?: number; note?: string; added_time?: string; added_by?: { name?: string } | null };

export default async function CandidateProfilePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [candidates, clients, placements, activity] = await Promise.all([
    recruiterflow.listAllCandidates({ perPage: 100 }),
    recruiterflow.listAllClients({ perPage: 100 }),
    prisma.placement.findMany({ where: { candidateRfId: id } }),
    prisma.actionLog.findMany({
      where: { subjectType: "candidate", subjectId: String(id) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const c = candidates.find((x) => x.id === id);
  if (!c) notFound();

  const name =
    c.name ??
    [c.first_name, c.last_name].filter(Boolean).join(" ") ??
    "(unnamed)";
  const locationLabel =
    c.location?.location ??
    [c.location?.city, c.location?.state].filter(Boolean).join(", ") ??
    "";
  const resume = pickResumeFile(c);
  const tagSet = collectTags(c);
  const isKept = tagSet.has("kept") || tagSet.has("keep");
  const displayTags = Array.from(tagSet).filter((t) => t !== "kept" && t !== "keep");

  const contactInitial: ContactState = {
    first_name: c.first_name ?? "",
    last_name: c.last_name ?? "",
    email: normalizeEmail(c.email),
    phone: normalizePhone(c.phone_number),
    location: locationLabel ?? "",
    linkedin_profile: c.linkedin_profile ?? "",
  };
  const expectedSalary = c.expected_salary as { number?: number | null; currency?: string | null } | null | undefined;
  const employmentInitial: EmploymentState = {
    current_designation: c.current_designation ?? "",
    current_organization: c.current_organization ?? "",
    expectedSalary: expectedSalary?.number ? String(expectedSalary.number) : "",
    expectedCurrency: expectedSalary?.currency ?? "USD",
  };

  const skillsInitial = Array.isArray(c.skills)
    ? (c.skills as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  const notesRaw: NoteRaw[] = Array.isArray(c.notes) ? (c.notes as NoteRaw[]) : [];
  const notesInitial: NoteRow[] = notesRaw.map((n) => ({
    id: n.id ?? null,
    note: n.note ?? "",
    addedByName: n.added_by?.name ?? null,
    addedAt: n.added_time ?? null,
  }));

  const experienceRaw: ExperienceRaw[] = Array.isArray(c.experience) ? (c.experience as ExperienceRaw[]) : [];
  const experienceInitial: ExperienceRow[] = experienceRaw.map((e) => ({
    designation: e.designation ?? "",
    organization: e.organization ?? "",
    description: e.description ?? "",
    from: e.from ?? [null, null],
    to: e.to ?? [null, null],
  }));

  const educationRaw: EducationRaw[] = Array.isArray(c.education) ? (c.education as EducationRaw[]) : [];
  const educationInitial: EducationRow[] = educationRaw.map((e) => ({
    school: e.school ?? "",
    degree: e.degree ?? "",
    description: e.description ?? "",
    from: e.from ?? [null, null],
    to: e.to ?? [null, null],
  }));

  const linkedSubmittals = (Array.isArray(c.jobs) ? c.jobs : []).filter((j) => typeof j?.job_id === "number");

  // Build the placement-action context: one row per linked job with RF stage,
  // local Placement snapshot (if any), and the client's default fee %.
  const placementByJob = new Map<number, (typeof placements)[number]>();
  for (const p of placements) placementByJob.set(p.jobRfId, p);

  const placementJobs: PlacementContextJob[] = linkedSubmittals.map((j: RFCandidateJob) => {
    const jobRfId = j.job_id!;
    const clientRfId = j.client_company_id ?? 0;
    const clientRaw = clients.find((cl) => cl.id === clientRfId);
    const client = clientRaw ? normalizeClient(clientRaw) : null;
    const local = placementByJob.get(jobRfId);
    const snapshot: PlacementSnapshot | null = local
      ? {
          id: local.id,
          stage: local.stage as PlacementSnapshot["stage"],
          syncedToRf: local.syncedToRf,
          offerSalary: local.offerSalary,
          offerCurrency: local.offerCurrency,
          offerTitle: local.offerTitle,
          offerStartDate: local.offerStartDate?.toISOString() ?? null,
          offerNotes: local.offerNotes,
          acceptedSalary: local.acceptedSalary,
          acceptedCurrency: local.acceptedCurrency,
          feePercentage: local.feePercentage,
          feeTotal: local.feeTotal,
          minFee: local.minFee,
          guaranteePeriodDays: local.guaranteePeriodDays,
          billingContactName: local.billingContactName,
          billingContactEmail: local.billingContactEmail,
          hiringManagerName: local.hiringManagerName,
          hiringManagerEmail: local.hiringManagerEmail,
          expectedStartDate: local.expectedStartDate?.toISOString() ?? null,
          placementNotes: local.placementNotes,
          startConfirmedAt: local.startConfirmedAt?.toISOString() ?? null,
        }
      : null;
    return {
      jobRfId,
      jobTitle: j.title ?? j.name ?? "(untitled job)",
      clientRfId,
      clientName: client?.name ?? j.client_company_name ?? "",
      clientFeePct: client?.feePct ?? null,
      rfStageBucket: canonicalStage(j.stage_name),
      placement: snapshot,
    };
  });

  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>

      <PageHeader
        eyebrow={c.current_organization ? `Currently at ${c.current_organization}` : "Candidate"}
        title={name}
        description={[c.current_designation, locationLabel].filter(Boolean).join(" · ") || undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isKept && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800">
                <Bookmark className="h-3 w-3" /> Kept
              </span>
            )}
            {displayTags.slice(0, 3).map((t) => (
              <span key={t} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-navy-400">
                {t}
              </span>
            ))}
          </div>
        }
      />

      <PlacementActions candidateRfId={id} jobs={placementJobs} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <EditableContact candidateId={id} initial={contactInitial} />
          <EditableEmployment candidateId={id} initial={employmentInitial} />
          <EditableSkills candidateId={id} initial={skillsInitial} />
          <EditableNotes candidateId={id} initial={notesInitial} />
        </div>

        <div className="space-y-6 lg:col-span-3">
          <div className="rounded-xl border border-border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="font-serif text-base font-semibold text-navy">Resume</h2>
                {resume && (
                  <p className="text-xs text-muted-foreground">
                    {resume.filename ?? "Resume"}
                    {resume.upload_time ? ` · uploaded ${new Date(resume.upload_time).toLocaleDateString()}` : ""}
                  </p>
                )}
              </div>
              {resume?.link && (
                <Link
                  href={resume.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-medium text-navy-400 shadow-sm transition hover:text-navy"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
            {resume?.link ? (
              <iframe
                title="Resume preview"
                src={resume.link}
                className="h-[700px] w-full rounded-b-xl border-0"
              />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 border-t border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                <FileText className="h-6 w-6 text-muted-foreground" />
                No resume on file in RecruiterFlow.
              </div>
            )}
          </div>

          <EditableExperience candidateId={id} initial={experienceInitial} />
          <EditableEducation candidateId={id} initial={educationInitial} />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-3">
          <h2 className="font-serif text-base font-semibold text-navy">Activity</h2>
          <p className="text-xs text-muted-foreground">
            Append-only log. Actions taken in Ace write here; RF stage moves and imports appear alongside.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {activity.length === 0 && linkedSubmittals.length === 0 && !c.added_time && (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">No activity yet.</li>
          )}
          {activity.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
              <div>
                <div className="text-sm text-navy">
                  <span className="font-medium">{a.user?.name ?? a.user?.email ?? "Someone"}</span>{" "}
                  <span className="text-muted-foreground">· {formatActionType(a.actionType)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</div>
              </div>
            </li>
          ))}
          {linkedSubmittals.map((j, i) => (
            <li key={`rf-${j.job_id}-${i}`} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
              <div className="min-w-0">
                <div className="text-sm text-navy">
                  <span className="font-medium">Stage: {stageLabel(j.stage_name)}</span>
                  <span className="text-muted-foreground"> on </span>
                  <Link href={`/jobs/${j.job_id}`} className="font-medium text-brand-dark hover:underline">
                    {j.title ?? j.name ?? "(untitled job)"}
                  </Link>
                  {j.client_company_name && <span className="text-muted-foreground"> at {j.client_company_name}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {j.stage_moved
                    ? `${new Date(j.stage_moved).toLocaleString()} · ${daysBetween(j.stage_moved) ?? 0}d in stage`
                    : "—"}
                </div>
              </div>
            </li>
          ))}
          {c.added_time && (
            <li className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
              <div>
                <div className="text-sm text-navy">
                  <span className="font-medium">Added to RecruiterFlow</span>
                  {c.added_by?.name && <span className="text-muted-foreground"> by {c.added_by.name}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">{new Date(c.added_time).toLocaleString()}</div>
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ---- helpers ----

function normalizeEmail(raw: RFCandidate["email"]): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function normalizePhone(raw: RFCandidate["phone_number"]): string {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string") return first;
    return first?.number ?? "";
  }
  return typeof raw === "string" ? raw : "";
}

function pickResumeFile(c: RFCandidate): RFFile | null {
  const files = Array.isArray(c.files) ? c.files : [];
  if (files.length === 0) return null;
  const primary = files.find((f) => f.is_primary);
  if (primary) return primary;
  const pdf = files.find((f) => (f.filename ?? "").toLowerCase().endsWith(".pdf"));
  if (pdf) return pdf;
  return files[0];
}

function collectTags(c: RFCandidate): Set<string> {
  const out = new Set<string>();
  const push = (t: unknown) => {
    if (!t) return;
    const name = typeof t === "string" ? t : typeof (t as { name?: string }).name === "string" ? (t as { name: string }).name : "";
    if (name) out.add(name.toLowerCase().trim());
  };
  (c.tags ?? []).forEach(push);
  (c.attributes ?? []).forEach(push);
  return out;
}

function stageLabel(stageName: string | null | undefined): string {
  const bucket = canonicalStage(stageName ?? "");
  if (bucket in PIPELINE_LABELS) return PIPELINE_LABELS[bucket as keyof typeof PIPELINE_LABELS];
  return stageName ?? "—";
}

function formatActionType(t: string): string {
  return t.replace(/_/g, " ");
}
