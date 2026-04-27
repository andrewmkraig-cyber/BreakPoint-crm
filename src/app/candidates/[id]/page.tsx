import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  Mail,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { formatLocation } from "@/lib/utils";
import { extractCandidateFields } from "@/lib/candidate-fields";
import { getCandidateByIdentifier, getRfClientsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import {
  canonicalStage,
  normalizeClient,
  normalizeJob,
  type PipelineBucket,
  type RFCandidate,
  type RFCandidateJob,
  type RFJob,
  type RFClient,
} from "@/lib/rf-payload-shapes";
import { getRfShapedContactsForOrg } from "@/lib/contacts";
import { EditableContact, type ContactState } from "@/app/candidates/[id]/editable-contact";
import { EditableEmployment, type EmploymentState } from "@/app/candidates/[id]/editable-employment";
import { EditableSkills } from "@/app/candidates/[id]/editable-skills";
import { EditableNotes, type NoteRow } from "@/app/candidates/[id]/editable-notes";
import { EditableExperience, type ExperienceRow } from "@/app/candidates/[id]/editable-experience";
import { EditableEducation, type EducationRow } from "@/app/candidates/[id]/editable-education";
import { EditableResume, type ResumeVersion } from "@/app/candidates/[id]/editable-resume";
// BrandResumeButton import removed in 5A.5.a — branding moves into the
// Edit Resume modal in 5A.5.b. The component itself still exists.
import { AddToListButton } from "@/components/lists/add-to-list-button";
import { SmsComposer } from "@/components/sms-composer";
import { TextingExchanges } from "@/components/texting-exchanges";
import { CallLogs } from "@/components/call-logs";
import { LocalCandidateProfile } from "@/app/candidates/[id]/local-profile";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getPlacementsForOrg } from "@/lib/placements";
import { getInterviewsForOrg } from "@/lib/interviews";
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
import AiWorkspace from "@/components/AiWorkspace";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CandidateTab = "profile" | "game-plan";

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

export default async function CandidateProfilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: CandidateTab };
}) {
  // Phase 1 candidate cutover: every candidate profile resolves through
  // Neon. The URL segment can be either a cuid (the canonical post-cutover
  // form) or a legacy numeric RF id; `getCandidateByIdentifier` handles
  // both and scopes the lookup by the caller's tenant.
  const candidate = await getCandidateByIdentifier(params.id);
  if (!candidate) notFound();

  // Ace-native candidates (never imported from RF) have no rfId and route
  // to the simpler LocalCandidateProfile UI — unchanged from pre-Phase 1.
  if (candidate.rfId == null) {
    return <LocalCandidateProfile id={candidate.id} />;
  }

  const id = candidate.rfId;
  // `raw` is the full RF payload captured during the Phase 0 import (and
  // refreshed by scripts/backfill-candidate-extras.ts). We read the display
  // fields from it so the existing profile template keeps working. Writes
  // go through updateCandidate() which merges back into `raw` + top-level
  // columns.
  const c: RFCandidate = (candidate.raw as RFCandidate | null) ?? {
    id,
    first_name: candidate.firstName,
    last_name: candidate.lastName ?? undefined,
    email: candidate.email ?? undefined,
    phone_number: candidate.phone ?? undefined,
    current_designation: candidate.currentDesignation ?? undefined,
    current_organization: candidate.currentOrganization ?? undefined,
    linkedin_profile: candidate.linkedinProfile ?? undefined,
    skills: candidate.skills,
  };

  const tab: CandidateTab = searchParams?.tab === "game-plan" ? "game-plan" : "profile";

  // Placement / Interview / CandidateResume are scoped by candidateId
  // (cuid) — candidateRfId is retained only as a historical reference and
  // must not be used in application queries.
  const [clients, contacts, allJobs, placements, interviews, localResume, jobOverrides, session, prefs, gmailTags] = await Promise.all([
    getRfClientsForOrg(),
    getRfShapedContactsForOrg(),
    // Phase 2: jobs come from Neon via the broadened shim (includes
    // both RF-imported and Ace-native rows; Ace-native rows carry
    // _aceJobId + _aceClientId for cuid-based write paths).
    getRfJobsForOrg(),
    // Phase 4a: Placement / Interview reads routed through the
    // tenant-scoped helpers. The helpers return full rows ordered by
    // scheduledAt asc (interviews) with no projection trimming — the
    // downstream renderers index into the full Placement / Interview
    // shapes.
    getPlacementsForOrg({ candidateId: candidate.id }),
    getInterviewsForOrg({ candidateId: candidate.id }),
    // Phase 5A.5.a: candidate can carry N resume versions. Fetch all
    // of them sorted newest-first so the version dropdown is driven
    // by real data; the display picks the most-recent or its redacted
    // variant by default (preserving the prior single-resume default).
    prisma.candidateResume.findMany({
      where: { candidateId: candidate.id, uploadComplete: true },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        filename: true,
        displayName: true,
        mimeType: true,
        size: true,
        uploadedAt: true,
        redactedAt: true,
        // Phase 5A.5.b: surfaces branded rows so we can label them
        // "Branded (date)" in the version dropdown. null/"original"
        // both mean a raw upload.
        variant: true,
        uploadedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.jobOverride.findMany({ select: { jobRfId: true, description: true } }),
    getServerSession(authOptions),
    getAppPreferences(),
    // Auto-tagged Gmail threads scoped to this candidate. Same query
    // shape as the Ace-native LocalCandidateProfile so the UI is
    // identical across both candidate paths.
    prisma.gmailThreadTag.findMany({
      where: {
        candidateId: candidate.id,
        organizationId: candidate.organizationId,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { threadId: true },
    }),
  ]);
  const aceTeam = await listAceTeam();
  const overrideByJob = new Map<number, string | null>();
  for (const o of jobOverrides) overrideByJob.set(o.jobRfId, o.description);
  const extractedName = extractCandidateFields(c);

  const name =
    c.name ??
    [c.first_name, c.last_name].filter(Boolean).join(" ") ??
    "(unnamed)";
  const locationLabel = formatLocation(c.location);
  // Phase 5A.5.a/b: flatten the N resume rows into the version array
  // the EditableResume component renders. Each row becomes one
  // "Original (date)" entry plus optionally a "Redacted (date)" entry
  // when redactedAt is set; rows with variant="branded" become a
  // "Branded (date)" entry instead of an Original. The findMany above
  // is already sorted by uploadedAt desc, so we then sort the flat
  // array by uploadedAt to interleave branded variants between
  // originals correctly (5A.5.b: "newest first alongside Original
  // and Redacted").
  const resumeVersions: ResumeVersion[] = [];
  for (const r of localResume) {
    if (r.variant === "branded") {
      resumeVersions.push({
        key: r.id,
        resumeId: r.id,
        kind: "branded",
        filename: r.filename,
        displayName: r.displayName,
        mimeType: r.mimeType,
        sizeBytes: r.size,
        uploadedAt: r.uploadedAt.toISOString(),
        uploadedByName: r.uploadedBy?.name ?? r.uploadedBy?.email ?? null,
      });
      continue;
    }
    resumeVersions.push({
      key: r.id,
      resumeId: r.id,
      kind: "original",
      filename: r.filename,
      displayName: r.displayName,
      mimeType: r.mimeType,
      sizeBytes: r.size,
      uploadedAt: r.uploadedAt.toISOString(),
      uploadedByName: r.uploadedBy?.name ?? r.uploadedBy?.email ?? null,
    });
    if (r.redactedAt) {
      resumeVersions.push({
        key: `${r.id}:redacted`,
        resumeId: r.id,
        kind: "redacted",
        filename: r.filename,
        displayName: r.displayName,
        // Redacted variant is always served as PDF by the redactor.
        mimeType: "application/pdf",
        sizeBytes: 0,
        uploadedAt: r.redactedAt.toISOString(),
        uploadedByName: r.uploadedBy?.name ?? r.uploadedBy?.email ?? null,
      });
    }
  }
  resumeVersions.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
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
  // Phase 2: Placement.jobRfId is nullable for Ace-native Jobs. This
  // lookup only fires for RF-imported candidates on the RF-page path —
  // their linked submittals come from RFCandidate.jobs[] which is
  // always keyed by RF numeric id. Skip rows where jobRfId is null
  // (those are Placements against Ace-native Jobs; they round-trip
  // through the localOnlyJobs loop below via the jobId cuid FK).
  const placementByJob = new Map<number, (typeof placements)[number]>();
  for (const p of placements) {
    if (p.jobRfId != null) placementByJob.set(p.jobRfId, p);
  }

  // Map the latest cancel_placement reason per placementId so the cancelled
  // badge can surface the reason the recruiter originally picked.
  // subjectId is polymorphic — legacy rows written before the Phase 1 cutover
  // carry String(rfId); rows written after carry the cuid. Query both so the
  // cancel reason surfaces regardless of when the placement was cancelled.
  const cancelLogs = await prisma.actionLog.findMany({
    where: {
      subjectType: "candidate",
      subjectId: { in: [candidate.id, String(id)] },
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
    if (iv.jobRfId == null) continue;
    const list = interviewsByJob.get(iv.jobRfId) ?? [];
    list.push(toInterviewSummary(iv));
    interviewsByJob.set(iv.jobRfId, list);
  }

  // Phase 4b: resolve cuid FKs for every Job / Client referenced by the
  // placement / open-job builders below. RF-imported rows get the cuid
  // via a batched legacyRfId → id lookup; Ace-native rows carry their
  // cuids on the shim payload as _aceJobId / _aceClientId. The maps
  // below back both PlacementContextJob and OpenJobOption assembly so
  // every jobCuid / clientCuid field is populated when possible.
  const jobCuidByRfId = new Map<number, string>();
  const clientCuidByRfId = new Map<number, string>();
  const referencedJobRfIds = new Set<number>();
  const referencedClientRfIds = new Set<number>();
  for (const j of linkedSubmittals) {
    if (typeof j.job_id === "number" && j.job_id > 0) referencedJobRfIds.add(j.job_id);
    if (typeof j.client_company_id === "number" && j.client_company_id > 0) {
      referencedClientRfIds.add(j.client_company_id);
    }
  }
  for (const raw of allJobs) {
    if (typeof raw.id === "number" && raw.id > 0) referencedJobRfIds.add(raw.id);
    if (raw.company && typeof raw.company.id === "number" && raw.company.id > 0) {
      referencedClientRfIds.add(raw.company.id);
    }
  }
  const orgForCuids = await getCurrentOrg();
  if (referencedJobRfIds.size > 0) {
    const rows = await prisma.job.findMany({
      where: {
        legacyRfId: { in: Array.from(referencedJobRfIds) },
        organizationId: orgForCuids.id,
      },
      select: { id: true, legacyRfId: true },
    });
    for (const r of rows) {
      if (r.legacyRfId != null) jobCuidByRfId.set(r.legacyRfId, r.id);
    }
  }
  if (referencedClientRfIds.size > 0) {
    const rows = await prisma.client.findMany({
      where: {
        legacyRfId: { in: Array.from(referencedClientRfIds) },
        organizationId: orgForCuids.id,
      },
      select: { id: true, legacyRfId: true },
    });
    for (const r of rows) {
      if (r.legacyRfId != null) clientCuidByRfId.set(r.legacyRfId, r.id);
    }
  }

  const placementJobs: PlacementContextJob[] = linkedSubmittals.map((j: RFCandidateJob) => {
    const jobRfId = j.job_id!;
    const clientRfId = j.client_company_id ?? 0;
    const clientRaw = clients.find((cl) => cl.id === clientRfId);
    const client = clientRaw ? normalizeClient(clientRaw) : null;
    const jobRaw = allJobs.find((jj) => jj.id === jobRfId) ?? null;
    const jobNorm = jobRaw ? normalizeJob(jobRaw) : null;
    // Phase 4b: cuid FKs — prefer the shim's _ace* for Ace-native Jobs,
    // fall back to the legacyRfId lookup map for RF-imported rows.
    const jobCuid = ((jobRaw as { _aceJobId?: string } | null)?._aceJobId ?? null) ||
      (jobCuidByRfId.get(jobRfId) ?? null);
    const clientCuid = ((jobRaw as { _aceClientId?: string } | null)?._aceClientId ?? null) ||
      (clientRfId > 0 ? clientCuidByRfId.get(clientRfId) ?? null : null);
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
      jobCuid,
      clientCuid,
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
    // RF-imported placements only (we're on the RF-candidate path).
    // Ace-native Job placements for this RF candidate are Phase 4
    // scope — they'd need the PlacementActions island to route writes
    // by jobCuid. Skip them here so the types stay clean.
    .filter((p) => p.jobRfId != null && !rfJobIdSet.has(p.jobRfId))
    .map((p) => {
      const jobRfId = p.jobRfId as number;
      const clientRfId = p.clientRfId ?? 0;
      const rfJob = allJobs.find((j) => j.id === jobRfId) ?? null;
      const job = rfJob ? normalizeJob(rfJob) : null;
      const clientRaw = clients.find((cl) => cl.id === clientRfId) ?? null;
      const client = clientRaw ? normalizeClient(clientRaw) : null;
      const clientContacts = contacts
        .filter((ct) => ct.client_company_id === clientRfId)
        .map((ct) => {
          const firstEmail = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
          const fullName = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
          return { id: ct.id, name: fullName, title: ct.current_designation ?? "", email: firstEmail };
        });
      const jobCuid = ((rfJob as { _aceJobId?: string } | null)?._aceJobId ?? null) ||
        (jobCuidByRfId.get(jobRfId) ?? p.jobId ?? null);
      const clientCuid = ((rfJob as { _aceClientId?: string } | null)?._aceClientId ?? null) ||
        (clientRfId > 0 ? clientCuidByRfId.get(clientRfId) ?? p.clientId ?? null : p.clientId ?? null);
      return {
        jobRfId,
        jobCuid,
        clientCuid,
        jobTitle: job?.title ?? "(job)",
        jobLocation: job?.location ?? "",
        jobDescription:
          overrideByJob.get(jobRfId) ??
          (typeof rfJob?.description === "string" ? rfJob.description : ""),
        jobSalaryRange: job?.compensation ?? "",
        clientRfId,
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
        interviews: interviewsByJob.get(jobRfId) ?? [],
      };
    });
  placementJobs.push(...localOnlyJobs);

  return (
    <CandidateProfileBoundary>
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg">
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
              <span key={t} className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-medium text-court-fg-muted">
                {t}
              </span>
            ))}
            <AddToListButton candidateId={candidate.id} candidateName={name} />
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
        openJobs={buildOpenJobOptions({ allJobs, clients, contacts, linkedJobIds: new Set(placementJobs.map((j) => j.jobRfId)), jobCuidByRfId, clientCuidByRfId })}
        aceTeam={aceTeam}
      />

      <Tabs tab={tab} candidateId={id} />

      {tab === "game-plan" ? (
        <AiWorkspace entityType="candidate" entityId={String(id)} />
      ) : (
        <>
          {/* Resume-first layout: the resume PDF is the primary content —
              ~70% viewport on lg+, the remaining ~30% is a scannable right
              sidebar with everything else. The 10-col grid is picked so the
              split lands at ~70/30, which is visibly resume-dominant
              instead of the old ~60/40 that still felt symmetric. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
            <div className="space-y-6 lg:col-span-7">
              <EditableResume
                candidateRfId={id}
                candidateId={candidate.id}
                versions={resumeVersions}
              />
              {/* Collapsible SMS thread. Sits right below the resume so recruiters
                  can glance at prior texts without scrolling to Activity. */}
              <TextingExchanges candidateId={String(id)} />
              {/* Call-log accordion. Click-to-call on the sidebar phone number
                  seeds this with an "initiated" row; the Krispcall webhook
                  back-fills duration + recording + final status later. */}
              <CallLogs candidateId={String(id)} />
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

          {gmailTags.length > 0 && (
            <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-court-fg">Email Threads</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {gmailTags.map((t) => (
                  <li key={t.threadId}>
                    <Link
                      href={`/mail?thread=${encodeURIComponent(t.threadId)}`}
                      className="inline-flex items-center gap-1.5 text-brand-dark hover:underline"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span className="font-mono text-xs">{t.threadId}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
    </CandidateProfileBoundary>
  );
}

function Tabs({ tab, candidateId }: { tab: CandidateTab; candidateId: number }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-court-border bg-court-surface p-1 shadow-sm">
      <TabLink label="Profile" href={`/candidates/${candidateId}`} active={tab === "profile"} />
      <TabLink label="Game Plan" href={`/candidates/${candidateId}?tab=game-plan`} active={tab === "game-plan"} />
    </div>
  );
}

function TabLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-brand-tint text-brand-dark" : "text-court-fg-muted hover:bg-court-surface-subtle",
      )}
    >
      <span>{label}</span>
    </Link>
  );
}

// ---- helpers ----

function buildOpenJobOptions({
  allJobs,
  clients,
  contacts,
  linkedJobIds,
  jobCuidByRfId,
  clientCuidByRfId,
}: {
  allJobs: RFJob[];
  clients: RFClient[];
  contacts: Awaited<ReturnType<typeof getRfShapedContactsForOrg>>;
  linkedJobIds: Set<number>;
  jobCuidByRfId: Map<number, string>;
  clientCuidByRfId: Map<number, string>;
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
      // Phase 4b: cuid FKs — Ace-native Jobs carry them on the shim
      // payload as _aceJobId/_aceClientId; RF-imported Jobs get the cuid
      // via the legacyRfId lookup map built in the parent.
      const aceJobId = (raw as { _aceJobId?: string })._aceJobId ?? null;
      const aceClientId = (raw as { _aceClientId?: string })._aceClientId ?? null;
      const jobCuid = aceJobId || (j.id > 0 ? jobCuidByRfId.get(j.id) ?? null : null);
      const clientCuid = aceClientId ||
        (j.companyId != null && j.companyId > 0 ? clientCuidByRfId.get(j.companyId) ?? null : null);
      return {
        jobRfId: j.id,
        jobCuid,
        clientCuid,
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
      jobTitle: iv.jobRfId != null ? titleByJob.get(iv.jobRfId) ?? "Interview" : "Interview",
      attendees,
    };
  });
}
