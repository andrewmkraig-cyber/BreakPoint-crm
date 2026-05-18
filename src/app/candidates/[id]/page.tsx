import Link from "next/link";
import { notFound } from "next/navigation";
import { NotebookPen, Send, Target } from "lucide-react";
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
import { type IdentityState } from "@/app/candidates/[id]/editable-identity";
import { EditableSkills } from "@/app/candidates/[id]/editable-skills";
import { EditableNotes, type NoteRow } from "@/app/candidates/[id]/editable-notes";
import { EditableResume, type ResumeVersion } from "@/app/candidates/[id]/editable-resume";
// BrandResumeButton import removed in 5A.5.a — branding moves into the
// Edit Resume modal in 5A.5.b. The component itself still exists.
import { AddToListButton } from "@/components/lists/add-to-list-button";
import { KeepCandidateButton } from "@/components/keep-candidate-button";
import { CandidateActivityCard } from "@/components/candidate-activity-card";
import { CandidateProfileNav } from "@/components/candidate-profile-nav";
import { CandidateCompactOverview } from "@/components/candidate-compact-overview";
import { toExpectedSalary } from "@/components/candidate-overview-helpers";
import { TextHighlighter } from "@/components/text-highlighter";
import {
  parseHighlightTokens,
  filterTokensToHaystack,
} from "@/app/candidates/[id]/highlight-tokens";
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
import { TabStrip } from "@/components/ui/tab-strip";
import { DeleteCandidateButton } from "@/app/candidates/[id]/delete-candidate-button";
import { listAceTeam } from "@/lib/ace-team";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAppPreferences } from "@/lib/preferences";
import AiWorkspace from "@/components/AiWorkspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CandidateTab = "profile" | "game-plan" | "notes";

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

type NoteRaw = { id?: number; note?: string; added_time?: string; added_by?: { name?: string } | null };

export default async function CandidateProfilePage({
  params,
  searchParams,
}: {
  params: { id: string };
  // `highlight` is a comma-separated list of search tokens passed by
  // the /candidates split-view iframe so the profile can wrap matching
  // text on mount. Optional — when absent the profile renders without
  // any highlight overlay.
  searchParams?: { tab?: CandidateTab; embed?: string; highlight?: string };
}) {
  // Phase 1 candidate cutover: every candidate profile resolves through
  // Neon. The URL segment can be either a cuid (the canonical post-cutover
  // form) or a legacy numeric RF id; `getCandidateByIdentifier` handles
  // both and scopes the lookup by the caller's tenant.
  const candidate = await getCandidateByIdentifier(params.id);
  if (!candidate) notFound();

  // Embed mode: the candidates split-view loads this page inside an
  // iframe and passes ?embed=true. AppShell strips the sidebar/topbar
  // chrome; here we drop the in-page back/prev/next nav so the iframe
  // shows just the profile content.
  const isEmbed = searchParams?.embed === "true";

  // Ace-native candidates (never imported from RF) have no rfId and route
  // to the simpler LocalCandidateProfile UI — unchanged from pre-Phase 1.
  if (candidate.rfId == null) {
    return (
      <LocalCandidateProfile
        id={candidate.id}
        tab={searchParams?.tab}
        embed={isEmbed}
        highlight={isEmbed ? searchParams?.highlight ?? null : null}
      />
    );
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

  const tab: CandidateTab =
    searchParams?.tab === "game-plan"
      ? "game-plan"
      : searchParams?.tab === "notes"
        ? "notes"
        : "profile";

  // Placement / Interview / CandidateResume are scoped by candidateId
  // (cuid) — candidateRfId is retained only as a historical reference and
  // must not be used in application queries.
  const [clients, contacts, allJobs, placements, interviews, localResume, jobOverrides, session, prefs] = await Promise.all([
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
    // gmailThreadTag fetch removed — the raw thread-id list rendered
    // poorly. Re-add once auto-tagging surfaces subject + preview.
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
  // Merge in the Candidate.tags column so the Keep toggle (which writes
  // there) shows immediately even when raw.tags hasn't been refreshed.
  for (const t of candidate.tags ?? []) {
    const name = t.toLowerCase().trim();
    if (name) tagSet.add(name);
  }
  const isKept = tagSet.has("kept") || tagSet.has("keep");
  const displayTags = Array.from(tagSet).filter((t) => t !== "kept" && t !== "keep");

  const expectedSalary = c.expected_salary as { number?: number | null; currency?: string | null } | null | undefined;
  const identityInitial: IdentityState = {
    first_name: c.first_name ?? "",
    last_name: c.last_name ?? "",
    email: normalizeEmail(c.email),
    phone: normalizePhone(c.phone_number),
    location: locationLabel ?? "",
    linkedin_profile: c.linkedin_profile ?? "",
    current_designation: c.current_designation ?? "",
    current_organization: c.current_organization ?? "",
    expected_salary: expectedSalary?.number ? String(expectedSalary.number) : "",
    expected_currency: expectedSalary?.currency ?? "USD",
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
          candidateSource: local.candidateSource ?? null,
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
          candidateSource: p.candidateSource ?? null,
          cancelledAt: p.stage === "cancelled" ? p.updatedAt.toISOString() : null,
          cancellationReason: null,
          cancellationDetail: null,
          rejectedAt: p.stage === "rejected" ? p.updatedAt.toISOString() : null,
        },
        interviews: interviewsByJob.get(jobRfId) ?? [],
      };
    });
  placementJobs.push(...localOnlyJobs);

  // Active-placement pills shown above the candidate-profile tab strip
  // on both surfaces (embed + non-embed). Only rows with a real local
  // Placement become pills (RF-only "sourced" tracking rows are not
  // pills). Filters out cancelled and rejected so the strip only
  // reflects jobs the candidate is still in play for.
  const activePills = placementJobs
    .filter((j) => {
      if (!j.placement) return false;
      return j.placement.stage !== "cancelled" && j.placement.stage !== "rejected";
    })
    .map((j) => ({
      id: j.placement!.id,
      title: j.jobTitle || "(job)",
      stage: j.placement!.stage as string,
    }));

  const phoneValue = normalizePhone(c.phone_number);

  // Embed = split-view iframe. Mirrors the non-embed left column
  // (compact overview + action row + resume) with a 280px right rail
  // for skills + activity. The candidates-page chrome bar dropped its
  // Apply / Keep duplicates so the left-column action row is the
  // single source of truth for Apply / Keep / Add to List / Add Note
  // across both surfaces. PlacementActionsIsland mounts chromeless
  // here so its Apply modal + ?openApply=true searchParams handler
  // stay alive without rendering the per-job pipeline row markup.
  if (isEmbed) {
    const rawHighlightTokens = parseHighlightTokens(searchParams?.highlight);
    // Same scope as the Ace-native embed (local-profile.tsx): keep only
    // the highlight tokens that actually appear somewhere on this
    // candidate so the chip strip / in-doc marks don't surface terms
    // that hit on a sibling row but found nothing here. Latest resume
    // extracted text only — the prior versions rarely change the set.
    const latestResumeText = rawHighlightTokens.length
      ? await prisma.candidateResume
          .findFirst({
            where: {
              candidateId: candidate.id,
              extractedText: { not: null },
            },
            orderBy: { uploadedAt: "desc" },
            select: { extractedText: true },
          })
          .then((r) => r?.extractedText ?? "")
      : "";
    const candidateHaystack = [
      candidate.firstName ?? "",
      candidate.lastName ?? "",
      identityInitial.first_name ?? "",
      identityInitial.last_name ?? "",
      identityInitial.current_designation ?? "",
      identityInitial.current_organization ?? "",
      identityInitial.location ?? "",
      (skillsInitial ?? []).join(" "),
      c.experience ? JSON.stringify(c.experience) : "",
      c.education ? JSON.stringify(c.education) : "",
      latestResumeText,
    ].join(" ");
    const highlightTokens = filterTokensToHaystack(
      rawHighlightTokens,
      candidateHaystack,
    );
    return (
      <CandidateProfileBoundary>
        {/* TextHighlighter walks the resume document subtree on mount
            and wraps matching tokens. Scoped to #resume-document-content
            (rendered by EditableResume around the DOCX preview only) so
            highlights never leak into the compact overview, name/email/
            phone/location header, skill chips, activity feed, or the
            highlight chip strip above the viewer. PDF resumes get their
            colored in-PDF marks from PdfCanvasViewer's canvas overlay
            instead — when PDF is showing, the scoped container doesn't
            exist and the walker no-ops. */}
        {highlightTokens.length > 0 && (
          <TextHighlighter
            tokens={highlightTokens}
            containerId="resume-document-content"
          />
        )}
        <PlacementActionsIsland
          chromeless
          candidateRfId={id}
          candidateFirstName={extractedName.firstName}
          candidateLastName={extractedName.lastName}
          candidateEmail={extractedName.email}
          candidatePhone={phoneValue}
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
        <div className="flex h-[calc(100vh-3rem)] gap-4 md:h-[calc(100vh-4rem)]">
          {/* Left column. Resume sits as high as possible — the action
              row above it is the only thing between the iframe top and
              the resume PDF. CompactOverview moved to the right rail
              so it's not duplicated against the resume header. */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {activePills.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {activePills.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full border border-court-accent/40 bg-court-accent-tint px-2.5 py-0.5 text-[11px] font-semibold text-court-brand-dark"
                  >
                    {p.title} · {p.stage}
                  </span>
                ))}
              </div>
            )}
            <UnderlineTabs tab={tab} candidateId={id} embed />
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/candidates/${id}?embed=true&openSubmit=1`}
                className={SUBMIT_LINK_CLASS}
              >
                <Send className="h-3 w-3" /> Submit to Job
              </Link>
              <Link
                href={`/candidates/${id}?embed=true&openApply=1`}
                className={APPLY_LINK_CLASS}
              >
                <Target className="h-3 w-3" /> Apply to Job
              </Link>
              <KeepCandidateButton candidateId={candidate.id} isKept={isKept} />
              <Link
                href={`/candidates/${id}?embed=true&tab=notes`}
                className={ADD_NOTE_LINK_CLASS}
              >
                <NotebookPen className="h-3 w-3" /> Add Note
              </Link>
              <AddToListButton
              candidateId={candidate.id}
              candidateName={name}
              className="px-3 py-1.5 text-sm font-medium"
            />
            </div>
            {tab === "game-plan" ? (
              <AiWorkspace
                entityType="candidate"
                entityId={String(id)}
                recipientEmail={candidate.email ?? null}
              />
            ) : tab === "notes" ? (
              <EditableNotes candidateId={id} initial={notesInitial} />
            ) : (
              <EditableResume
                candidateRfId={id}
                candidateId={candidate.id}
                versions={resumeVersions}
                tokens={highlightTokens}
              />
            )}
          </div>
          {/* Right rail. CompactOverview as a single tight summary box,
              then skills, then the call/email/text activity card. The
              highlight chip strip lives above the resume viewer (rendered
              by EditableResume), so the right rail no longer repeats it.
              Width locked to w-72 so the center resume pane keeps the
              dominant width on the page. */}
          <aside className="flex w-72 flex-shrink-0 flex-col gap-4 overflow-y-auto">
            <CandidateCompactOverview
              candidateRef={candidate.id}
              fullName={name}
              firstName={identityInitial.first_name || null}
              lastName={identityInitial.last_name || null}
              currentDesignation={identityInitial.current_designation || null}
              currentOrganization={identityInitial.current_organization || null}
              location={identityInitial.location || null}
              email={identityInitial.email || null}
              phone={phoneValue || null}
              linkedinProfile={identityInitial.linkedin_profile || null}
              expectedSalary={toExpectedSalary(c.expected_salary)}
              highlightTokens={highlightTokens}
            />
            <EditableSkills candidateId={id} initial={skillsInitial} />
            <CandidateActivityCard
              candidateId={candidate.id}
              toNumber={phoneValue || null}
            />
          </aside>
        </div>
      </CandidateProfileBoundary>
    );
  }

  return (
    <CandidateProfileBoundary>
    <div className="space-y-6">
      {isEmbed ? null : <CandidateProfileNav currentId={candidate.id} />}

      {/* The standalone name header was folded into the identity card
          at the top of the left column below so all candidate-identity
          info lives in one place (name + title + location + employer +
          contact + employment + activity). The h1 still anchors the
          page for SEO / a11y - it just renders inside the sidebar
          card now instead of as a floating header band. */}

      {/* Pipeline section is always mounted so the header Submit to Job
          link can open the Submit modal even when the candidate has no
          placements yet. When jobs is empty, PlacementActions renders
          its own dashed "click Submit to Job to add one" empty state. */}
      <section id="pipeline">
        <PlacementActionsIsland
          candidateRfId={id}
          candidateFirstName={extractedName.firstName}
          candidateLastName={extractedName.lastName}
          candidateEmail={extractedName.email}
          candidatePhone={phoneValue}
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
      </section>

      {/* Two-column layout. Left column is the working surface — the
          Profile/Game Plan/Notes tab strip, then the action row, then
          the tab content (Resume on Profile, AiWorkspace on Game Plan,
          notes editor on Notes). The right column is a tight reference
          rail (compact overview + skills + activity). The redundant
          large identity card was dropped in favor of the single
          CompactOverview box. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {activePills.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activePills.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border border-court-accent/40 bg-court-accent-tint px-2.5 py-0.5 text-[11px] font-semibold text-court-brand-dark"
                >
                  {p.title} · {p.stage}
                </span>
              ))}
            </div>
          )}
          <div className="sticky top-20 z-10 -mx-2 flex flex-wrap items-center gap-3 rounded-lg bg-court-bg/85 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-court-bg/75">
            <UnderlineTabs tab={tab} candidateId={id} />
            {displayTags.slice(0, 3).map((t) => (
              <span key={t} className="inline-flex items-center rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-medium text-court-fg-muted">
                {t}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/candidates/${id}?openSubmit=1`}
              className={SUBMIT_LINK_CLASS}
            >
              <Send className="h-3 w-3" /> Submit to Job
            </Link>
            <Link
              href={`/candidates/${id}?openApply=1`}
              className={APPLY_LINK_CLASS}
            >
              <Target className="h-3 w-3" /> Apply to Job
            </Link>
            <KeepCandidateButton candidateId={candidate.id} isKept={isKept} />
            <Link
              href={`/candidates/${id}?tab=notes`}
              className={ADD_NOTE_LINK_CLASS}
            >
              <NotebookPen className="h-3 w-3" /> Add Note
            </Link>
            <AddToListButton
              candidateId={candidate.id}
              candidateName={name}
              className="px-3 py-1.5 text-sm font-medium"
            />
          </div>
          {tab === "game-plan" ? (
            <AiWorkspace
              entityType="candidate"
              entityId={String(id)}
              recipientEmail={candidate.email ?? null}
            />
          ) : tab === "notes" ? (
            <EditableNotes candidateId={id} initial={notesInitial} />
          ) : (
            <EditableResume
              candidateRfId={id}
              candidateId={candidate.id}
              versions={resumeVersions}
            />
          )}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <CandidateCompactOverview
            candidateRef={candidate.id}
            fullName={name}
            firstName={identityInitial.first_name || null}
            lastName={identityInitial.last_name || null}
            currentDesignation={identityInitial.current_designation || null}
            currentOrganization={identityInitial.current_organization || null}
            location={identityInitial.location || null}
            email={identityInitial.email || null}
            phone={phoneValue || null}
            linkedinProfile={identityInitial.linkedin_profile || null}
            expectedSalary={toExpectedSalary(c.expected_salary)}
          />
          <EditableSkills candidateId={id} initial={skillsInitial} />
          <CandidateActivityCard candidateId={candidate.id} toNumber={phoneValue || null} />
        </div>
      </div>

      <DeleteCandidateButton candidateId={candidate.id} candidateName={name} />
    </div>
    </CandidateProfileBoundary>
  );
}


// Anchor-shaped twins of the shared Button "apply" / "secondary" variants.
// Used for the candidate-level action row above the resume so the buttons
// pick up the same Court Mode tokens as <Button> without nesting a
// <button> inside an <a> (Link wraps an <a>).
// Submit to Job pill — green filled, rounded-full. Matches the
// Submit chip on the Applicants page so the affirmative submittal
// action reads the same on both surfaces.
const SUBMIT_LINK_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-court-brand bg-court-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-court-brand-dark";

// Anchor-shaped twin of <Button variant="apply">. Token classes mirror
// the amber apply variant so the Apply to Job link renders identically
// to the matching <Button> without nesting a <button> inside an <a>.
const APPLY_LINK_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60";

const ADD_NOTE_LINK_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800";

function UnderlineTabs({
  tab,
  candidateId,
  embed = false,
}: {
  tab: CandidateTab;
  candidateId: number;
  embed?: boolean;
}) {
  const embedPrefix = embed ? "embed=true&" : "";
  return (
    <TabStrip<CandidateTab>
      activeId={tab}
      ariaLabel="Candidate profile sections"
      items={[
        {
          id: "profile",
          label: "Profile",
          href: `/candidates/${candidateId}${embed ? "?embed=true" : ""}`,
        },
        {
          id: "game-plan",
          label: "Game Plan",
          href: `/candidates/${candidateId}?${embedPrefix}tab=game-plan`,
        },
        {
          id: "notes",
          label: "Notes",
          href: `/candidates/${candidateId}?${embedPrefix}tab=notes`,
        },
      ]}
    />
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
        jobLocation: j.location,
        jobCompensation: j.compensation,
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
    location: iv.location,
    notes: iv.notes,
  };
}
