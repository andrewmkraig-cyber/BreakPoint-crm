import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { formatLocation } from "@/lib/utils";
import { extractCandidateFields } from "@/lib/candidate-fields";
import {
  recruiterflow,
  canonicalStage,
  normalizeClient,
  normalizeJob,
  type PipelineBucket,
  type RFCandidate,
  type RFCandidateJob,
  type RFJob,
  type RFClient,
} from "@/lib/recruiterflow";
import { EditableContact, type ContactState } from "@/app/candidates/[id]/editable-contact";
import { EditableEmployment, type EmploymentState } from "@/app/candidates/[id]/editable-employment";
import { EditableSkills } from "@/app/candidates/[id]/editable-skills";
import { EditableNotes, type NoteRow } from "@/app/candidates/[id]/editable-notes";
import { EditableExperience, type ExperienceRow } from "@/app/candidates/[id]/editable-experience";
import { EditableEducation, type EducationRow } from "@/app/candidates/[id]/editable-education";
import { EditableResume, type ResumeState } from "@/app/candidates/[id]/editable-resume";
import { SmsComposer } from "@/components/sms-composer";
import { TextingExchanges } from "@/components/texting-exchanges";
import { LocalCandidateProfile } from "@/app/candidates/[id]/local-profile";
import type {
  InterviewSummary,
  OpenJobOption,
  PlacementContextJob,
  PlacementSnapshot,
} from "@/app/candidates/[id]/placement-flows";
import { PlacementActionsIsland } from "@/app/candidates/[id]/placement-actions-island";
import { CandidateProfileBoundary } from "@/app/candidates/[id]/candidate-profile-boundary";
import { ActivityPanel, type ActivityInterview } from "@/app/candidates/[id]/activity-panel";
import { listAceTeam } from "@/lib/ace-team";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAppPreferences } from "@/lib/preferences";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Placement.billingContacts is a Json column — Prisma types it loosely as
// JsonValue. Coerce to our snapshot shape defensively: keep only objects with
// string name + email, drop everything else. Returns null (not []) when the
// column is null so the UI can fall back to the legacy single-contact fields
// without mistaking "we migrated, zero contacts" for "row never touched."
function normalizeBillingContacts(
  raw: unknown,
): Array<{ name: string; email: string }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ name: string; email: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const email = typeof rec.email === "string" ? rec.email : "";
    if (name || email) out.push({ name, email });
  }
  return out;
}

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
  // Ace-native candidates have cuid string ids; RF candidates have numeric ids.
  // Route accordingly so /candidates/[id] works for both without a separate URL.
  if (!/^\d+$/.test(params.id)) {
    return <LocalCandidateProfile id={params.id} />;
  }
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [candidates, clients, contacts, allJobs, placements, interviews, localResume, jobOverrides, session, prefs] = await Promise.all([
    recruiterflow.listAllCandidates({ perPage: 100 }),
    recruiterflow.listAllClients({ perPage: 100 }),
    recruiterflow.listAllContacts({ perPage: 100 }),
    recruiterflow.listAllJobs({ perPage: 100 }),
    prisma.placement.findMany({ where: { candidateRfId: id } }),
    prisma.interview.findMany({
      where: { candidateRfId: id },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.candidateResume.findUnique({
      where: { candidateRfId: id },
      select: {
        filename: true,
        mimeType: true,
        size: true,
        uploadComplete: true,
        uploadedAt: true,
        redactedAt: true,
        uploadedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.jobOverride.findMany({ select: { jobRfId: true, description: true } }),
    getServerSession(authOptions),
    getAppPreferences(),
  ]);
  const aceTeam = await listAceTeam();
  const overrideByJob = new Map<number, string | null>();
  for (const o of jobOverrides) overrideByJob.set(o.jobRfId, o.description);
  // eslint-disable-next-line no-console
  console.log("[candidate page]", id, "loaded jobOverrides", {
    count: jobOverrides.length,
    descriptions: jobOverrides.map((o) => ({
      jobRfId: o.jobRfId,
      descLength: o.description?.length ?? 0,
    })),
  });

  // Two-source lookup: /candidate/list caches for 60s (Next Data Cache), so a
  // freshly-created candidate may not appear immediately. /candidate/{id}
  // has been flaky externally but sometimes succeeds. Try both; only 404 if
  // the candidate truly can't be resolved from either source.
  const listed = candidates.find((x) => x.id === id) ?? null;
  let c: RFCandidate | null = listed;
  try {
    const fetched = await recruiterflow.getCandidate(id);
    if (fetched && typeof fetched === "object") c = fetched;
  } catch {
    // keep the listed record if getCandidate fails
  }
  if (!c) notFound();
  const extractedName = extractCandidateFields(c);

  const name =
    c.name ??
    [c.first_name, c.last_name].filter(Boolean).join(" ") ??
    "(unnamed)";
  const locationLabel = formatLocation(c.location);
  const localResumeInitial: ResumeState = localResume && localResume.uploadComplete
    ? {
        filename: localResume.filename,
        mimeType: localResume.mimeType,
        sizeBytes: localResume.size,
        uploadedAt: localResume.uploadedAt.toISOString(),
        uploadedByName: localResume.uploadedBy?.name ?? localResume.uploadedBy?.email ?? null,
        redactedAt: localResume.redactedAt ? localResume.redactedAt.toISOString() : null,
      }
    : null;
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

  // Map the latest cancel_placement reason per placementId so the cancelled
  // badge can surface the reason the recruiter originally picked.
  const cancelLogs = await prisma.actionLog.findMany({
    where: {
      subjectType: "candidate",
      subjectId: String(id),
      actionType: "cancel_placement",
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  const cancelReasonByPlacement = new Map<string, { reason: string | null; detail: string | null }>();
  for (const log of cancelLogs) {
    const meta = log.metadata as { placementId?: string; reason?: string; detail?: string | null } | null;
    if (!meta?.placementId || cancelReasonByPlacement.has(meta.placementId)) continue;
    cancelReasonByPlacement.set(meta.placementId, {
      reason: meta.reason ?? null,
      detail: typeof meta.detail === "string" ? meta.detail : null,
    });
  }

  const interviewsByJob = new Map<number, InterviewSummary[]>();
  for (const iv of interviews) {
    const list = interviewsByJob.get(iv.jobRfId) ?? [];
    list.push(toInterviewSummary(iv));
    interviewsByJob.set(iv.jobRfId, list);
  }

  const placementJobs: PlacementContextJob[] = linkedSubmittals.map((j: RFCandidateJob) => {
    const jobRfId = j.job_id!;
    const clientRfId = j.client_company_id ?? 0;
    const clientRaw = clients.find((cl) => cl.id === clientRfId);
    const client = clientRaw ? normalizeClient(clientRaw) : null;
    const jobRaw = allJobs.find((jj) => jj.id === jobRfId) ?? null;
    const jobNorm = jobRaw ? normalizeJob(jobRaw) : null;
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
          billingContacts: normalizeBillingContacts(local.billingContacts),
          hiringManagerName: local.hiringManagerName,
          hiringManagerEmail: local.hiringManagerEmail,
          expectedStartDate: local.expectedStartDate?.toISOString() ?? null,
          placementNotes: local.placementNotes,
          startConfirmedAt: local.startConfirmedAt?.toISOString() ?? null,
          cancelledAt: local.stage === "cancelled" ? local.updatedAt.toISOString() : null,
          cancellationReason: local.stage === "cancelled" ? cancelReasonByPlacement.get(local.id)?.reason ?? null : null,
          cancellationDetail: local.stage === "cancelled" ? cancelReasonByPlacement.get(local.id)?.detail ?? null : null,
          rejectedAt: local.stage === "rejected" ? local.updatedAt.toISOString() : null,
        }
      : null;
    const clientContacts = contacts
      .filter((ct) => ct.client_company_id === clientRfId)
      .map((ct) => {
        const firstEmail = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
        const fullName =
          [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
        return {
          id: ct.id,
          name: fullName,
          title: ct.current_designation ?? "",
          email: firstEmail,
        };
      });
    return {
      jobRfId,
      jobTitle: j.title ?? j.name ?? "(untitled job)",
      jobLocation: jobNorm?.location ?? "",
      jobDescription:
        overrideByJob.get(jobRfId) ??
        (typeof jobRaw?.description === "string" ? jobRaw.description : ""),
      jobSalaryRange: jobNorm?.compensation ?? "",
      clientRfId,
      clientName: client?.name ?? j.client_company_name ?? "",
      clientWebsite: client?.website ?? "",
      clientLinkedIn: client?.linkedIn ?? "",
      clientFeePct: client?.feePct ?? null,
      rfStageBucket: canonicalStage(j.stage_name),
      rfStageName: j.stage_name ?? null,
      rfStageMovedAt: j.stage_moved ?? null,
      clientContacts,
      placement: snapshot,
      interviews: interviewsByJob.get(jobRfId) ?? [],
    };
  });

  // Placements may exist for jobs not in the RF candidate's `jobs` array —
  // the RF list endpoint caches, so fresh submits/apps haven't propagated
  // yet. Mirror those into the placement-actions context so scheduling still
  // works for jobs attached only locally.
  const rfJobIdSet = new Set(placementJobs.map((j) => j.jobRfId));
  const localOnlyJobs: PlacementContextJob[] = placements
    .filter((p) => !rfJobIdSet.has(p.jobRfId))
    .map((p) => {
      const rfJob = allJobs.find((j) => j.id === p.jobRfId) ?? null;
      const job = rfJob ? normalizeJob(rfJob) : null;
      const clientRaw = clients.find((cl) => cl.id === p.clientRfId) ?? null;
      const client = clientRaw ? normalizeClient(clientRaw) : null;
      const clientContacts = contacts
        .filter((ct) => ct.client_company_id === p.clientRfId)
        .map((ct) => {
          const firstEmail = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
          const fullName = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
          return { id: ct.id, name: fullName, title: ct.current_designation ?? "", email: firstEmail };
        });
      return {
        jobRfId: p.jobRfId,
        jobTitle: job?.title ?? "(job)",
        jobLocation: job?.location ?? "",
        jobDescription:
          overrideByJob.get(p.jobRfId) ??
          (typeof rfJob?.description === "string" ? rfJob.description : ""),
        jobSalaryRange: job?.compensation ?? "",
        clientRfId: p.clientRfId,
        clientName: client?.name ?? "",
        clientWebsite: client?.website ?? "",
        clientLinkedIn: client?.linkedIn ?? "",
        clientFeePct: client?.feePct ?? null,
        rfStageBucket: "sourced" as PipelineBucket,
        rfStageName: null,
        rfStageMovedAt: null,
        clientContacts,
        placement: {
          id: p.id,
          stage: p.stage as PlacementSnapshot["stage"],
          syncedToRf: p.syncedToRf,
          offerSalary: p.offerSalary,
          offerCurrency: p.offerCurrency,
          offerTitle: p.offerTitle,
          offerStartDate: p.offerStartDate?.toISOString() ?? null,
          offerNotes: p.offerNotes,
          acceptedSalary: p.acceptedSalary,
          acceptedCurrency: p.acceptedCurrency,
          feePercentage: p.feePercentage,
          feeTotal: p.feeTotal,
          minFee: p.minFee,
          guaranteePeriodDays: p.guaranteePeriodDays,
          billingContactName: p.billingContactName,
          billingContactEmail: p.billingContactEmail,
          billingContacts: normalizeBillingContacts(p.billingContacts),
          hiringManagerName: p.hiringManagerName,
          hiringManagerEmail: p.hiringManagerEmail,
          expectedStartDate: p.expectedStartDate?.toISOString() ?? null,
          placementNotes: p.placementNotes,
          startConfirmedAt: p.startConfirmedAt?.toISOString() ?? null,
          cancelledAt: p.stage === "cancelled" ? p.updatedAt.toISOString() : null,
          cancellationReason: null,
          cancellationDetail: null,
          rejectedAt: p.stage === "rejected" ? p.updatedAt.toISOString() : null,
        },
        interviews: interviewsByJob.get(p.jobRfId) ?? [],
      };
    });
  placementJobs.push(...localOnlyJobs);

  return (
    <CandidateProfileBoundary>
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

      <PlacementActionsIsland
        candidateRfId={id}
        candidateFirstName={extractedName.firstName}
        candidateLastName={extractedName.lastName}
        candidateEmail={extractedName.email}
        candidatePhone={normalizePhone(c.phone_number)}
        candidateLocation={locationLabel ?? ""}
        candidateCurrentTitle={c.current_designation ?? ""}
        candidateCurrentEmployer={c.current_organization ?? ""}
        recruiter={(() => {
          const email = session?.user?.email ?? "";
          const fullName = session?.user?.name ?? "";
          const firstName = fullName.split(/\s+/)[0] ?? "";
          const phone = email
            ? prefs.recruiterPhones[email] ?? prefs.recruiterPhones[email.toLowerCase()] ?? ""
            : "";
          return { firstName, fullName, email, phone };
        })()}
        jobs={placementJobs}
        openJobs={buildOpenJobOptions({ allJobs, clients, contacts, linkedJobIds: new Set(placementJobs.map((j) => j.jobRfId)) })}
        aceTeam={aceTeam}
      />

      {/* Resume-first layout: the resume PDF is the primary content —
          ~70% viewport on lg+, the remaining ~30% is a scannable right
          sidebar with everything else. The 10-col grid is picked so the
          split lands at ~70/30, which is visibly resume-dominant
          instead of the old ~60/40 that still felt symmetric. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <div className="space-y-6 lg:col-span-7">
          <EditableResume candidateRfId={id} initial={localResumeInitial} />
          {/* Collapsible SMS thread. Sits right below the resume so recruiters
              can glance at prior texts without scrolling to Activity. */}
          <TextingExchanges candidateId={String(id)} />
        </div>

        <aside className="space-y-6 lg:col-span-3">
          <EditableContact candidateId={id} initial={contactInitial} />
          {/* SMS composer slots in directly below the phone-number card so
              the input sits next to the number it'll be texting. Pass the
              normalized candidate phone from EditableContact's source. */}
          <SmsComposer candidateId={String(id)} toNumber={normalizePhone(c.phone_number) || null} />
          <EditableEmployment candidateId={id} initial={employmentInitial} />
          <EditableSkills candidateId={id} initial={skillsInitial} />
          <EditableExperience candidateId={id} initial={experienceInitial} />
          <EditableEducation candidateId={id} initial={educationInitial} />
          <EditableNotes candidateId={id} initial={notesInitial} />
        </aside>
      </div>

      <ActivityPanel interviews={buildActivityInterviews(interviews, placementJobs)} />
    </div>
    </CandidateProfileBoundary>
  );
}

// ---- helpers ----

function buildOpenJobOptions({
  allJobs,
  clients,
  contacts,
  linkedJobIds,
}: {
  allJobs: RFJob[];
  clients: RFClient[];
  contacts: Awaited<ReturnType<typeof recruiterflow.listAllContacts>>;
  linkedJobIds: Set<number>;
}): OpenJobOption[] {
  const clientById = new Map<number, RFClient>();
  for (const cl of clients) clientById.set(cl.id, cl);

  return allJobs
    .filter((j) => j.is_open !== false)
    .map((raw) => {
      const j = normalizeJob(raw);
      const client = j.companyId != null ? clientById.get(j.companyId) : null;
      const clientContacts = (j.companyId != null ? contacts.filter((ct) => ct.client_company_id === j.companyId) : [])
        .map((ct) => {
          const firstEmail = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
          const fullName =
            [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
          return {
            id: ct.id,
            name: fullName,
            title: ct.current_designation ?? "",
            email: firstEmail,
          };
        });
      return {
        jobRfId: j.id,
        jobTitle: j.title,
        clientRfId: j.companyId ?? 0,
        clientName: client ? normalizeClient(client).name : j.company,
        alreadyLinked: linkedJobIds.has(j.id),
        clientContacts,
      } satisfies OpenJobOption;
    })
    .sort((a, b) => {
      if (a.alreadyLinked !== b.alreadyLinked) return a.alreadyLinked ? 1 : -1;
      const c = (a.clientName || "").localeCompare(b.clientName || "");
      if (c !== 0) return c;
      return (a.jobTitle || "").localeCompare(b.jobTitle || "");
    });
}

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

type InterviewRow = Awaited<ReturnType<typeof prisma.interview.findMany>>[number];

function toInterviewSummary(iv: InterviewRow): InterviewSummary {
  const attendees = Array.isArray(iv.clientAttendees)
    ? (iv.clientAttendees as { name?: string; email?: string }[])
        .map((a) => ({ name: a.name ?? "", email: a.email ?? "" }))
        .filter((a) => a.name || a.email)
    : [];
  return {
    id: iv.id,
    scheduledAt: iv.scheduledAt.toISOString(),
    durationMin: iv.durationMin,
    type: iv.type as InterviewSummary["type"],
    status: iv.status as InterviewSummary["status"],
    source: iv.source as InterviewSummary["source"],
    meetLink: iv.meetLink,
    attendees,
    candidatePhone: iv.candidatePhone,
    notes: iv.notes,
  };
}

// Flatten all interviews on a candidate into the shape ActivityPanel
// renders. We map jobRfId → jobTitle from the placement context so the
// history rows show "Interview · Tax Manager" instead of a bare
// timestamp. Defensive: if the job isn't in placementJobs (rare —
// happens for orphaned interviews from a deleted placement) we fall
// back to "Interview" so the row still renders.
function buildActivityInterviews(
  interviews: Awaited<ReturnType<typeof prisma.interview.findMany>>,
  placementJobs: PlacementContextJob[],
): ActivityInterview[] {
  const titleByJob = new Map<number, string>();
  for (const j of placementJobs) titleByJob.set(j.jobRfId, j.jobTitle);
  return interviews.map((iv) => {
    const attendees = Array.isArray(iv.clientAttendees)
      ? (iv.clientAttendees as { name?: string; email?: string }[])
          .map((a) => ({ name: a.name ?? "", email: a.email ?? "" }))
          .filter((a) => a.name || a.email)
      : [];
    return {
      id: iv.id,
      scheduledAt: iv.scheduledAt.toISOString(),
      durationMin: iv.durationMin,
      type: iv.type as ActivityInterview["type"],
      status: iv.status as ActivityInterview["status"],
      source: iv.source as ActivityInterview["source"],
      jobTitle: titleByJob.get(iv.jobRfId) ?? "Interview",
      attendees,
    };
  });
}
