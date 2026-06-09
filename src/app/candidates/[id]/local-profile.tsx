import Link from "next/link";
import { notFound } from "next/navigation";
import { Target } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { getRfClientsForOrg, getRfContactsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { extractFeePctFromCustomFields } from "@/lib/clients";
import { formatDistanceSubLine } from "@/lib/distance";
import { LocalCandidateActions, type LocalOpenJob } from "@/app/candidates/[id]/local-candidate-actions";
import { LocalPlacementRows, type LocalJobRow, type LocalInterview } from "@/app/candidates/[id]/local-placement-rows";
import { LocalEditableSkills } from "@/app/candidates/[id]/local-editable-skills";
import { CandidateActivityCard } from "@/components/candidate-activity-card";
import { CandidateProfileNav } from "@/components/candidate-profile-nav";
import { CandidateCompactOverview } from "@/components/candidate-compact-overview";
import { CandidateNotesPanel } from "@/components/notes/candidate-notes-panel";
import { getNotesForEntity } from "@/lib/notes/queries";
import { toExpectedSalary } from "@/components/candidate-overview-helpers";
import { formatExpectedCompensation } from "@/lib/candidate-compensation";
import { cn } from "@/lib/utils";
import { TextHighlighter } from "@/components/text-highlighter";
import {
  parseHighlightTokens,
  filterTokensToHaystack,
} from "@/app/candidates/[id]/highlight-tokens";
import AiWorkspace from "@/components/AiWorkspace";
import { TabStrip } from "@/components/ui/tab-strip";
// 5A.5.b parity: Ace-native candidates now share the same resume
// management UI as RF-imported (multi-version dropdown, inline rename,
// redact, brand). The inline single-resume preview was retired.
import { EditableResume, type ResumeVersion } from "@/app/candidates/[id]/editable-resume";
import { AddToListButton } from "@/components/lists/add-to-list-button";
import { KeepCandidateButton } from "@/components/keep-candidate-button";
import { DeleteCandidateButton } from "@/app/candidates/[id]/delete-candidate-button";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPlacementsForOrg } from "@/lib/placements";
import { getInterviewsForOrg } from "@/lib/interviews";
import { getAppPreferences } from "@/lib/preferences";


// Normalize a Placement.billingContacts / hiringContacts JSON value into the
// { name, email }[] shape the placement dialog seeds from. Keeps name-only
// rows (blank email); drops fully-empty entries; tolerates non-array / legacy
// nulls by returning [].
function parseSnapshotContacts(value: unknown): { name: string; email: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    const email = typeof o.email === "string" ? o.email : "";
    return name || email ? [{ name, email }] : [];
  });
}

type LocalCandidateTab = "profile" | "game-plan" | "notes";

export async function LocalCandidateProfile({
  id,
  tab: tabParam,
  embed = false,
  highlight = null,
}: {
  id: string;
  tab?: string;
  embed?: boolean;
  // Comma-separated search tokens passed through from the candidates
  // split-view. Embed branch parses this into a token list and
  // mounts <TextHighlighter> at the top so matches inside the
  // overview, resume, skills, and activity cards get wrapped in
  // <mark> on mount.
  highlight?: string | null;
}) {
  const tab: LocalCandidateTab =
    tabParam === "game-plan"
      ? "game-plan"
      : tabParam === "notes"
        ? "notes"
        : "profile";
  const [candidate, placements, interviews, allJobs, allClients, allContacts, jobOverrides, session, prefs] = await Promise.all([
    prisma.candidate.findUnique({
      where: { id },
      select: {
        id: true,
        rfId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        altEmails: true,
        altPhones: true,
        currentDesignation: true,
        currentOrganization: true,
        location: true,
        // lat/lng (backfilled by scripts/geocode-candidates.ts) feed the
        // candidate side of the job-pill distance (Item 1B). Null on
        // candidates that haven't been geocoded — distance just blanks.
        lat: true,
        lng: true,
        linkedinProfile: true,
        skills: true,
        tags: true,
        notes: true,
        experience: true,
        education: true,
        expectedSalary: true,
        // Inline single-resume columns are still read so we can lazy-
        // backfill the multi-version table for Ace-native candidates
        // created before 5A.5.b. Once a CandidateResume row exists for
        // this candidate, these columns are no longer the source of
        // truth — EditableResume reads from CandidateResume.
        resumeFilename: true,
        resumeMimeType: true,
        resumeSize: true,
        resumeUploadedAt: true,
        resumeData: true,
        organizationId: true,
        createdAt: true,
        createdById: true,
        // gmailTags select removed — raw thread-id list rendered poorly.
        // Re-add once auto-tagging surfaces subject + preview.
      },
    }),
    // Phase 4a: Placement / Interview reads routed through the
    // tenant-scoped helpers. Both take candidateId and return the full
    // row — the local-profile renderer reads jobRfId, jobId, clientRfId,
    // clientId, stage, updatedAt off each row so no select projection
    // was load-bearing.
    // Include cancelled rows so the Ace-native profile still surfaces
    // cancelled placements in the candidate's history strip (mirrors
    // the candidates/[id] page above).
    getPlacementsForOrg({ candidateId: id, includeCancelled: true }),
    getInterviewsForOrg({ candidateId: id }),
    // Populates the Submit/Apply dropdowns with existing open jobs.
    // Reads are served from Neon (the Phase 0 import populated Job/
    // Client/Contact from the RF payload). This keeps the page working
    // when RF is unreachable — the smoke test in CI depends on it.
    getRfJobsForOrg().catch(() => []),
    getRfClientsForOrg().catch(() => []),
    getRfContactsForOrg().catch(() => []),
    prisma.jobOverride.findMany({ select: { jobRfId: true, description: true } }),
    getServerSession(authOptions),
    getAppPreferences(),
  ]);
  const overrideByJob = new Map<number, string | null>();
  for (const o of jobOverrides) overrideByJob.set(o.jobRfId, o.description);
  // Per-placement trace: shows the candidate's placement jobRfIds and
  // whether each one matched a JobOverride row + how long its description
  // was. This pinpoints the failure mode for [Job Description]:
  //   - override missing entirely → save never persisted (Option A) or
  //     the user saved against a different RF id (Option B variant).
  //   - override present but descLength=0 → save persisted with an empty
  //     description (the row exists but the field is null).
  //   - override present with descLength>0 → resolver should be picking
  //     it up; if the merge field still looks blank look at how the value
  //     flows downstream into InviteFlowState.
  const placementTrace = placements.map((p) => {
    const ov = p.jobRfId != null ? overrideByJob.get(p.jobRfId) : null;
    return {
      placementId: p.id,
      jobRfId: p.jobRfId,
      jobId: p.jobId,
      hasOverrideRow: p.jobRfId != null ? overrideByJob.has(p.jobRfId) : false,
      overrideDescLength: ov?.length ?? 0,
    };
  });
  // eslint-disable-next-line no-console
  console.log("[local candidate page]", id, "loaded jobOverrides", {
    overrideRowCount: jobOverrides.length,
    overrideRows: jobOverrides.map((o) => ({
      jobRfId: o.jobRfId,
      descLength: o.description?.length ?? 0,
    })),
    placementTrace,
  });

  if (!candidate) notFound();

  // Phase 5A.5.b — Ace-native parity. EditableResume reads from
  // CandidateResume rows; older Ace-native candidates may still hold
  // their resume only on Candidate.resumeData (the legacy inline
  // columns). When that's the case and there are no CandidateResume
  // rows yet, materialize one so the multi-version dropdown / rename /
  // redact / brand all work without a manual migration step. This is a
  // one-time cost per candidate — subsequent loads see the row and
  // skip the backfill. We intentionally don't clear the inline columns:
  // leaving them in place keeps the legacy /api/local-candidate-resumes
  // route working for any URL still hardcoded to it.
  let candidateResumeRows = await prisma.candidateResume.findMany({
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
      variant: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });
  if (
    candidateResumeRows.length === 0 &&
    candidate.resumeData &&
    candidate.resumeMimeType &&
    candidate.resumeFilename
  ) {
    try {
      // Copy the inline bytes into a fresh ArrayBuffer-backed Uint8Array
      // so the Prisma Bytes typing doesn't trip on Buffer's widened
      // ArrayBufferLike generic.
      const bytes = candidate.resumeData;
      const ab = new ArrayBuffer(bytes.byteLength);
      const data = new Uint8Array(ab);
      data.set(bytes);
      await prisma.candidateResume.create({
        data: {
          candidateId: candidate.id,
          // Ace-native rows have no RF id — column is nullable as of
          // Ace 20.0. The previous -Date.now() synthetic placeholder
          // overflowed PostgreSQL Int4 and 500'd the backfill insert.
          candidateRfId: candidate.rfId,
          organizationId: candidate.organizationId,
          filename: candidate.resumeFilename,
          mimeType: candidate.resumeMimeType,
          size: candidate.resumeSize ?? bytes.byteLength,
          data,
          uploadComplete: true,
          uploadedById: candidate.createdById,
          uploadedAt: candidate.resumeUploadedAt ?? candidate.createdAt,
        },
      });
      candidateResumeRows = await prisma.candidateResume.findMany({
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
          variant: true,
          uploadedBy: { select: { name: true, email: true } },
        },
      });
    } catch (err) {
      // Best-effort backfill — if it fails (e.g., a transient DB error),
      // log and fall through. The page still renders without the resume
      // section rather than 500ing.
      // eslint-disable-next-line no-console
      console.warn("[local-profile] CandidateResume backfill failed:", err);
    }
  }
  const resumeVersions: ResumeVersion[] = [];
  for (const r of candidateResumeRows) {
    // Phase 5A.5.b (Ace 20.0): DOCX → PDF conversions land as their
    // own row. Surface as kind="converted" so the dropdown labels them
    // distinctly from raw originals.
    if (r.variant === "converted") {
      resumeVersions.push({
        key: r.id,
        resumeId: r.id,
        kind: "converted",
        filename: r.filename,
        displayName: r.displayName,
        mimeType: r.mimeType,
        sizeBytes: r.size,
        uploadedAt: r.uploadedAt.toISOString(),
        uploadedByName: r.uploadedBy?.name ?? r.uploadedBy?.email ?? null,
      });
      continue;
    }
    // Phase 5A.5.b (Bug C): the unified editor produces "branded",
    // "redacted", or "branded-redacted" rows. The first two get their
    // own dropdown kind; "branded-redacted" surfaces under the
    // "Branded" label since the visible artifact has the logo on it.
    if (r.variant === "branded" || r.variant === "branded-redacted") {
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
    // Phase 5A.5.b (Ace 20.0 / Bug B): redacted rows now live as their
    // own CandidateResume row (variant="redacted", bytes in `data`).
    // Surface as a distinct dropdown entry, parallel to branded.
    if (r.variant === "redacted") {
      resumeVersions.push({
        key: r.id,
        resumeId: r.id,
        kind: "redacted",
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
    // Legacy redacted-companion synthesis was removed in Ace 20.0.
    // Pre-Bug-B data with redactedAt set on the original row no longer
    // surfaces a paired "Redacted" entry here — every redaction now
    // lives as its own variant="redacted" row, and the companion
    // synthesis caused a dropdown delete to clobber the original
    // because both entries shared the same resumeId.
  }
  resumeVersions.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  // Most recent resume version on file (sorted desc above). Drives the
  // Submit composer's auto-attach note; the actual bytes are fetched +
  // attached server-side in sendLocalSubmittalEmail using the same
  // uploadedAt-desc ordering, so the displayed name matches what ships.
  const latestResumeName = resumeVersions[0]
    ? resumeVersions[0].displayName || resumeVersions[0].filename
    : null;

  const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "(unnamed)";
  const candidateCompensation = formatExpectedCompensation(candidate.expectedSalary);

  // Two identity keys — RF-imported placements hash by jobRfId (numeric),
  // Ace-native placements hash by jobId (cuid string). The LocalOpenJob
  // matcher below tries both so the "alreadyLinked" flag works for either
  // identity shape without a third keyspace.
  const linkedByRfJob = new Map<number, string>();
  const linkedByAceJob = new Map<string, string>();
  for (const p of placements) {
    if (p.jobRfId != null) linkedByRfJob.set(p.jobRfId, p.stage);
    else if (p.jobId) linkedByAceJob.set(p.jobId, p.stage);
  }

  const clientById = new Map<number, (typeof allClients)[number]>();
  for (const cl of allClients) clientById.set(cl.id, cl);

  // Side-load Client.feePct + Client.customFields for every placement
  // client so LocalJobRow.clientFeePct can seed the OfferDialog /
  // LocalPlacementDialog auto-fills. allClients only carries the RF-
  // shaped raw payload; the typed Prisma columns (feePct backfilled by
  // scripts/backfill-client-feepct.ts, customFields for the defensive
  // extract fallback) live next to it and aren't surfaced through
  // getRfClientsForOrg. Tenant-scoped via candidate.organizationId.
  const placementClientCuids = new Set<string>();
  const placementClientRfIds = new Set<number>();
  for (const p of placements) {
    if (p.clientId) placementClientCuids.add(p.clientId);
    if (p.clientRfId != null && p.clientRfId > 0) placementClientRfIds.add(p.clientRfId);
  }
  const feePctByCuid = new Map<string, number | null>();
  const feePctByRfId = new Map<number, number | null>();
  if (placementClientCuids.size > 0 || placementClientRfIds.size > 0) {
    const rows = await prisma.client.findMany({
      where: {
        organizationId: candidate.organizationId,
        OR: [
          ...(placementClientCuids.size > 0
            ? [{ id: { in: Array.from(placementClientCuids) } }]
            : []),
          ...(placementClientRfIds.size > 0
            ? [{ legacyRfId: { in: Array.from(placementClientRfIds) } }]
            : []),
        ],
      },
      select: { id: true, legacyRfId: true, feePct: true, customFields: true },
    });
    for (const r of rows) {
      const resolved =
        r.feePct ?? extractFeePctFromCustomFields(r.customFields ?? null) ?? null;
      feePctByCuid.set(r.id, resolved);
      if (r.legacyRfId != null) feePctByRfId.set(r.legacyRfId, resolved);
    }
  }

  const openJobs: LocalOpenJob[] = allJobs
    // ACTIVE-status jobs only (item #12). isOpen=true covers BOTH "active"
    // AND "private" lifecycles, so the old `is_open !== false` filter let
    // private jobs into the Apply / Keep pickers. Mirror the canonical
    // /jobs Active-tab test: private/inactive excluded, else fall back to
    // isOpen. _lifecycle is carried on every row by getRfJobsForOrg (org-
    // scoped, Rule 8).
    .filter((j) => {
      const lc = (j as { _lifecycle?: string | null })._lifecycle;
      if (lc === "private" || lc === "inactive") return false;
      return j.is_open !== false;
    })
    .map((raw) => {
      const j = normalizeJob(raw);
      const client = j.companyId != null ? clientById.get(j.companyId) : null;
      const aceJobId = (raw as { _aceJobId?: string })._aceJobId ?? null;
      const aceClientId = (raw as { _aceClientId?: string })._aceClientId ?? null;
      // Contact match: prefer the cuid pathway (`_aceClientId` carries
      // the Client cuid for every contact, RF-imported or Ace-native —
      // the canonical FK per CLAUDE.md rule 3). Fall back to the legacy
      // numeric client_company_id === companyId path for any contact
      // whose `_aceClientId` wasn't populated, so RF-imported clients
      // keep behaving exactly as they did before this fix.
      const clientContacts = (aceClientId || j.companyId != null)
        ? allContacts
            .filter((ct) =>
              (aceClientId && ct._aceClientId === aceClientId) ||
              (j.companyId != null && ct.client_company_id === j.companyId),
            )
            .map((ct) => ({
              id: ct.id,
              name:
                [ct.first_name, ct.last_name].filter(Boolean).join(" ") ||
                ct.name ||
                "(unnamed)",
              title: ct.current_designation ?? "",
              email: Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "",
            }))
        : [];
      const alreadyLinked = aceJobId
        ? linkedByAceJob.has(aceJobId)
        : linkedByRfJob.has(j.id);
      const linkedStage = aceJobId
        ? linkedByAceJob.get(aceJobId) ?? null
        : linkedByRfJob.get(j.id) ?? null;
      return {
        jobRfId: j.id,
        jobCuid: aceJobId,
        jobTitle: j.title,
        jobLocation: j.location,
        jobCompensation: j.compensation,
        clientRfId: j.companyId ?? 0,
        clientCuid: aceClientId,
        clientName: client ? normalizeClient(client).name : j.company,
        alreadyLinked,
        linkedStage,
        clientContacts,
      };
    })
    .sort((a, b) => {
      if (a.alreadyLinked !== b.alreadyLinked) return a.alreadyLinked ? 1 : -1;
      const c = (a.clientName || "").localeCompare(b.clientName || "");
      if (c !== 0) return c;
      return (a.jobTitle || "").localeCompare(b.jobTitle || "");
    });

  // Interview join key: RF-imported → numeric jobRfId, Ace-native →
  // cuid jobId. Stringify so the same Map covers both.
  const interviewsByJob = new Map<string, LocalInterview[]>();
  for (const iv of interviews) {
    const key = iv.jobRfId != null ? `rf:${iv.jobRfId}` : iv.jobId ? `ace:${iv.jobId}` : null;
    if (!key) continue;
    const list = interviewsByJob.get(key) ?? [];
    const attendees = Array.isArray(iv.clientAttendees)
      ? (iv.clientAttendees as { name?: string; email?: string }[])
          .map((a) => ({ name: a.name ?? "", email: a.email ?? "" }))
          .filter((a) => a.name || a.email)
      : [];
    list.push({
      id: iv.id,
      scheduledAt: iv.scheduledAt.toISOString(),
      durationMin: iv.durationMin,
      type: iv.type as LocalInterview["type"],
      status: iv.status as LocalInterview["status"],
      source: iv.source as LocalInterview["source"],
      meetLink: iv.meetLink,
      attendees,
      location: iv.location,
      // 2b-ii: stored sent copies + delivery flags for the edit scheduler.
      sentClientSubject: iv.sentClientSubject,
      sentClientBody: iv.sentClientBody,
      sentCandidateSubject: iv.sentCandidateSubject,
      sentCandidateBody: iv.sentCandidateBody,
      clientInvited: iv.sentClientAt != null,
      candidateInvited: iv.sentCandidateAt != null,
    });
    interviewsByJob.set(key, list);
  }

  // ---- Job-pill distance (Item 1B) ----
  // Candidate.lat/lng (selected above) vs. each linked job's Neon
  // location (zip / city / state) through the SAME shared geocoder +
  // helper the pipeline uses (src/lib/geocode.ts + formatDistanceSubLine
  // in src/lib/distance.ts — no second helper, no second geocoder). The
  // distance is keyed by placementId so the jobRows map can attach it.
  // Blank where the candidate has no lat/lng or the job side can't be
  // resolved — no distance shown, no error (same blank rule as the
  // pipeline). Query is org-scoped per Rule 8.
  const distanceByPlacementId = new Map<string, string>();
  if (candidate.lat != null && candidate.lng != null) {
    const placementJobCuids = placements
      .map((p) => p.jobId)
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    const placementJobRfIds = placements
      .map((p) => p.jobRfId)
      .filter((x): x is number => typeof x === "number");
    const jobLocOr: Prisma.JobWhereInput[] = [];
    if (placementJobCuids.length > 0) jobLocOr.push({ id: { in: placementJobCuids } });
    if (placementJobRfIds.length > 0) jobLocOr.push({ legacyRfId: { in: placementJobRfIds } });
    const jobLocRows = jobLocOr.length > 0
      ? await prisma.job.findMany({
          where: { organizationId: candidate.organizationId, OR: jobLocOr },
          select: {
            id: true,
            legacyRfId: true,
            locationZip: true,
            locationCity: true,
            locationState: true,
          },
        })
      : [];
    type JobLoc = { zip: string | null; city: string | null; state: string | null };
    const jobLocByCuid = new Map<string, JobLoc>();
    const jobLocByRfId = new Map<number, JobLoc>();
    for (const j of jobLocRows) {
      const loc: JobLoc = { zip: j.locationZip, city: j.locationCity, state: j.locationState };
      jobLocByCuid.set(j.id, loc);
      if (j.legacyRfId != null) jobLocByRfId.set(j.legacyRfId, loc);
    }
    for (const p of placements) {
      const loc = p.jobId
        ? jobLocByCuid.get(p.jobId)
        : p.jobRfId != null
          ? jobLocByRfId.get(p.jobRfId)
          : null;
      if (!loc) continue;
      const line = await formatDistanceSubLine(
        candidate.lat,
        candidate.lng,
        loc.zip,
        loc.city,
        loc.state,
      );
      if (line) distanceByPlacementId.set(p.id, line);
    }
  }

  const jobRows: LocalJobRow[] = placements.map((p) => {
    const rfJob = p.jobRfId != null
      ? allJobs.find((j) => j.id === p.jobRfId) ?? null
      : p.jobId
        ? allJobs.find((j) => (j as { _aceJobId?: string })._aceJobId === p.jobId) ?? null
        : null;
    const job = rfJob ? normalizeJob(rfJob) : null;
    const clientRaw = p.clientRfId != null ? clientById.get(p.clientRfId) ?? null : null;
    const client = clientRaw ? normalizeClient(clientRaw) : null;
    // Cuid-first contact match (same pattern as openJobs above). The
    // prior `p.clientRfId != null` gate left every Ace-native placement
    // with an empty clientContacts array — that's the To/Cc picker
    // emptiness symptom in the Submit composer. RF-imported placements
    // continue to match via the legacy numeric client_company_id path.
    const clientContacts = (p.clientId || p.clientRfId != null)
      ? allContacts
          .filter((ct) =>
            (p.clientId && ct._aceClientId === p.clientId) ||
            (p.clientRfId != null && ct.client_company_id === p.clientRfId),
          )
          .map((ct) => {
            const firstEmail = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
            const fullNameC = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
            return { id: ct.id, name: fullNameC, title: ct.current_designation ?? "", email: firstEmail };
          })
      : [];
    const rawDescription = typeof rfJob?.description === "string" ? rfJob.description : "";
    // Interview join. scheduleInterview stored the interview with the SAME
    // jobRfId the schedule call was made with — for Ace-native jobs that is
    // the synthetic `syntheticIdFromCuid` id (rfJob.id), NOT the cuid and NOT
    // p.jobRfId (which is null for Ace-native). So an Ace-native interview is
    // keyed `rf:<synthetic>` while the placement only knew `ace:<cuid>`, and
    // the two never matched — leaving job.interviews empty and the Edit
    // Interview button hidden. Look up every key the interview could carry
    // (real rfId, synthetic rfId, cuid), deduped by interview id.
    const interviewKeys = [
      p.jobRfId != null ? `rf:${p.jobRfId}` : null,
      rfJob?.id != null ? `rf:${rfJob.id}` : null,
      p.jobId ? `ace:${p.jobId}` : null,
    ].filter((k): k is string => k != null);
    const seenInterviewIds = new Set<string>();
    const rowInterviews: LocalInterview[] = [];
    for (const k of interviewKeys) {
      for (const iv of interviewsByJob.get(k) ?? []) {
        if (seenInterviewIds.has(iv.id)) continue;
        seenInterviewIds.add(iv.id);
        rowInterviews.push(iv);
      }
    }
    // Slim placement snapshot — drives the late-stage dialogs (Edit
    // Offer / Make Placement / Edit Placement) so they can seed their
    // form fields without an extra round trip. Dates are ISO strings
    // (not Date) so the client component doesn't have to thread the
    // Date class through React's serialization boundary.
    const placementSnapshot = {
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
      hiringManagerName: p.hiringManagerName,
      hiringManagerEmail: p.hiringManagerEmail,
      // Full multi-contact lists (JSON) so LocalPlacementDialog can reopen an
      // edited placement with every billing / hiring row intact, not just the
      // first one mirrored into the legacy single columns above.
      billingContacts: parseSnapshotContacts(p.billingContacts),
      hiringContacts: parseSnapshotContacts(p.hiringContacts),
      expectedStartDate: p.expectedStartDate?.toISOString() ?? null,
      placementNotes: p.placementNotes,
      candidateSource: p.candidateSource,
      // Custom Payment Agreement — threaded so the candidate-profile Edit
      // Placement dialog renders the same full field set as the /pipeline
      // drawer (getPlacementsForOrg selects all scalar columns, so these
      // are already loaded on `p`).
      useCustomTerms: p.useCustomTerms,
      installmentCount: p.installmentCount,
      inst1Amount: p.inst1Amount,
      inst1DaysAfterStart: p.inst1DaysAfterStart,
      inst2Amount: p.inst2Amount,
      inst2DaysAfterStart: p.inst2DaysAfterStart,
      inst3Amount: p.inst3Amount,
      inst3DaysAfterStart: p.inst3DaysAfterStart,
      customGuaranteeDate: p.customGuaranteeDate?.toISOString() ?? null,
    };
    // Prefer cuid lookup (canonical) — only fall back to the rfId map
    // when this placement has no clientId cuid yet (pre-Phase-0 rows;
    // the backfill in scripts/backfill-placement-clientid.ts stamped
    // every existing one but new RF imports may still land cuid-null
    // before the loader fix at src/lib/candidates.ts:316 catches them).
    const resolvedClientFeePct =
      (p.clientId ? feePctByCuid.get(p.clientId) ?? null : null) ??
      (p.clientRfId != null ? feePctByRfId.get(p.clientRfId) ?? null : null);
    return {
      placementId: p.id,
      jobRfId: p.jobRfId ?? (rfJob?.id ?? 0),
      jobCuid: p.jobId,
      jobTitle: job?.title ?? "(job)",
      jobLocation: job?.location ?? "",
      // "(X.X mi)" candidate→job distance (Item 1B). Blank when either
      // side can't resolve. Same helper + geocoder the pipeline uses.
      distance: distanceByPlacementId.get(p.id) ?? null,
      jobDescription:
        (p.jobRfId != null ? overrideByJob.get(p.jobRfId) : null) ??
        rawDescription,
      jobSalaryRange: job?.compensation ?? "",
      clientRfId: p.clientRfId ?? 0,
      clientCuid: p.clientId,
      clientName: client?.name ?? job?.company ?? "",
      clientWebsite: client?.website ?? "",
      clientLinkedIn: client?.linkedIn ?? "",
      clientFeePct: resolvedClientFeePct,
      clientContacts,
      stage: p.stage,
      interviews: rowInterviews,
      placement: placementSnapshot,
      // Lightweight presence flag only. getPlacementsForOrg returns the
      // full Placement row, so startConfirmationFile (Bytes) is already in
      // server memory here — we derive a boolean and deliberately do NOT
      // copy the bytes into jobRows, so the page payload stays slim. The
      // image itself streams on demand from /api/placement-screenshot/<id>.
      hasStartConfirmation: p.startConfirmationFile != null,
    };
  });

  const recruiter = (() => {
    const email = session?.user?.email ?? "";
    const fullName2 = session?.user?.name ?? "";
    const firstName = fullName2.split(/\s+/)[0] ?? "";
    const phone = email
      ? prefs.recruiterPhones[email] ?? prefs.recruiterPhones[email.toLowerCase()] ?? ""
      : "";
    return { firstName, fullName: fullName2, email, phone };
  })();

  // KeepCandidateButton consumes a slim placement summary + an open-jobs
  // picker. Both are derived from the same `placements` / `openJobs`
  // already in scope, just narrowed to the fields the dialog needs.
  // Ace-native jobs carry their cuid (p.jobId / p.clientId); RF-imported
  // jobs carry the numeric ids on jobRfId / clientRfId. The dialog +
  // keepLocalCandidateForJob action handle either identity shape, so we
  // forward both whenever present.
  const keepPlacementSummaries = placements.map((p) => {
    const rfJob = p.jobRfId != null
      ? allJobs.find((j) => j.id === p.jobRfId) ?? null
      : p.jobId
        ? allJobs.find((j) => (j as { _aceJobId?: string })._aceJobId === p.jobId) ?? null
        : null;
    const job = rfJob ? normalizeJob(rfJob) : null;
    const clientRaw = p.clientRfId != null ? clientById.get(p.clientRfId) ?? null : null;
    const client = clientRaw ? normalizeClient(clientRaw) : null;
    return {
      placementId: p.id,
      jobRfId: p.jobRfId,
      jobCuid: p.jobId,
      jobTitle: job?.title ?? "(job)",
      clientRfId: p.clientRfId,
      clientCuid: p.clientId,
      clientName: client?.name ?? job?.company ?? "",
      stage: p.stage,
    };
  });
  const keepOpenJobs = openJobs
    .filter((j) => !j.alreadyLinked)
    .map((j) => ({
      // openJobs synthesizes a negative numeric jobRfId for Ace-native
      // rows (djb2 of the cuid). Forward the real cuid as the identity
      // and leave jobRfId null in that case so the server action picks
      // the cuid path. RF-imported jobs flip the other way.
      jobRfId: j.jobCuid ? null : j.jobRfId,
      jobCuid: j.jobCuid ?? null,
      jobTitle: j.jobTitle,
      clientRfId: j.clientCuid ? null : j.clientRfId,
      clientCuid: j.clientCuid ?? null,
      clientName: j.clientName,
    }));

  // Embed = split-view iframe. Renders the same left column as the full
  // profile (compact overview + action row + resume) and a 280px right
  // rail with skills + activity. The action row is the single source of
  // truth for Apply / Keep / Add to List / Add Note — the candidates-page
  // chrome bar dropped its Apply / Keep duplicates in favor of this row.
  // LocalCandidateActions mounts with hideButtons so its modals stay
  // alive (Apply dialog + searchParams trigger) without rendering a
  // second visible button row.
  if (embed) {
    const rawHighlightTokens = parseHighlightTokens(highlight);
    // Drop tokens that don't actually appear anywhere on this candidate
    // so the chip strip / in-doc highlights only surface terms with a
    // real hit. The haystack mirrors the server-side search corpus
    // (name + structured cols + skills + experience/education JSON +
    // latest resume extracted text) so a token routed to the embed
    // because a sibling row matched on it doesn't render an empty chip
    // here. Latest resume only — older versions rarely change the
    // outcome and would double the per-load query cost.
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
      candidate.currentDesignation ?? "",
      candidate.currentOrganization ?? "",
      candidate.location ?? "",
      (candidate.skills ?? []).join(" "),
      candidate.experience ? JSON.stringify(candidate.experience) : "",
      candidate.education ? JSON.stringify(candidate.education) : "",
      latestResumeText,
    ].join(" ");
    const highlightTokens = filterTokensToHaystack(
      rawHighlightTokens,
      candidateHaystack,
    );
    // openJobs / jobRows / interviewsByJob were lifted above the
    // embed/non-embed split so both surfaces share the same shaped
    // data. LocalCandidateActions takes the same openJobs in both
    // branches, and the standard LocalPlacementRows pipeline strip
    // (rendered below) takes jobRows.
    return (
      <>
        {/* Scoped to #resume-document-content (rendered by
            EditableResume around the DOCX preview only). Keeps
            highlights inside the resume body so the overview, skills,
            activity cards, and the chip strip above the viewer never
            get amber-marked. PDF mode skips the wrapper — the canvas
            overlay handles its own colored marks. */}
        {highlightTokens.length > 0 && (
          <TextHighlighter
            tokens={highlightTokens}
            containerId="resume-document-content"
          />
        )}
        <LocalCandidateActions
          candidateId={candidate.id}
          candidateName={fullName}
          candidateFirstName={candidate.firstName}
          candidateEmail={candidate.email}
          candidateLocation={candidate.location}
          candidateCompensation={candidateCompensation}
          openJobs={openJobs}
          latestResumeName={latestResumeName}
          hideButtons
        />
        <div className="flex h-[calc(100vh-3rem)] gap-4 md:h-[calc(100vh-4rem)]">
          {/* Left column. The pipeline strip + tab strip sit above the
              action row so pipeline state and tab navigation are the
              first things a recruiter sees in the iframe. CompactOverview
              moved to the right rail so it's not duplicated against the
              resume header. */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {/* Single sticky bundle pinned to the top of the scroll
                container: job pill rows on top, then the tabs +
                action row. Submit/Apply/Keep/Add-to-List stay in
                view at every scroll position, and the job pill
                headers (with their per-row Submit/Schedule/etc.
                affordances) stay visible alongside them so the
                recruiter can act on the active placement without
                scrolling back up. When the candidate has no jobs
                LocalPlacementRows returns null and the sticky bar
                collapses to just the tabs + action row. */}
            <div className="sticky top-0 z-10 -mx-1 mt-4 space-y-2 rounded-lg bg-court-bg/85 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-court-bg/75">
              {/* Always mounted: LocalPlacementRows renders null when there
                  are no placements but keeps its apply-event listener live
                  so the first Apply-to-Job shows its pill without a
                  reload. */}
              <LocalPlacementRows
                candidateId={candidate.id}
                candidateName={fullName}
                candidateEmail={candidate.email}
                candidatePhone={candidate.phone}
                candidateLocation={candidate.location}
                candidateCurrentTitle={candidate.currentDesignation}
                candidateCurrentEmployer={candidate.currentOrganization}
                recruiter={recruiter}
                jobs={jobRows}
                embed
              />
              {/* flex-nowrap + min-w-0 lets the action group ellipsize
                  button labels instead of wrapping to a second row when
                  the embed panel is narrow. */}
              <div className="flex items-center justify-between gap-3">
                <UnderlineTabs tab={tab} candidateId={candidate.id} embed />
                {/* Submit removed from the action bar — the canonical
                    Submit entry point is the per-job-pill Submit
                    rendered by LocalPlacementRows above. */}
                <div className="flex min-w-0 shrink items-center gap-2">
                  <Link
                    href={`/candidates/${candidate.id}?embed=true&openApply=1`}
                    className={cn(APPLY_LINK_CLASS, "min-w-0")}
                    title="Apply to Job"
                  >
                    <Target className="h-3 w-3 shrink-0" />
                    <span className="truncate">Apply to Job</span>
                  </Link>
                  <KeepCandidateButton
                    candidate={{ kind: "local", cuid: candidate.id }}
                    placements={keepPlacementSummaries}
                    openJobs={keepOpenJobs}
                    // Tab-chip size: px-2.5 py-1 text-[13px] gap-1
                    // matches the Profile/Game Plan/Notes tabs sitting
                    // beside this button. twMerge picks the later
                    // padding/text/gap utilities, so this overrides
                    // both the size="sm" defaults and the keep
                    // variant's normal sizing without changing the
                    // KeepCandidateButton's behavior on other surfaces.
                    className="min-w-0 gap-1 border-blue-400 px-2.5 py-1 text-[13px] dark:border-blue-500"
                  />
                  <AddToListButton
                    candidateId={candidate.id}
                    candidateName={fullName}
                    // Same tab-chip size as the siblings — overrides
                    // ADD_TO_LIST_BUTTON_CLASS's px-2.5 py-1.5 + text-xs
                    // defaults via twMerge.
                    className="min-w-0 gap-1 border-court-fg-muted/50 px-2.5 py-1 text-[13px] font-medium"
                  />
                </div>
              </div>
            </div>
            {tab === "game-plan" ? (
              <AiWorkspace
                entityType="candidate"
                entityId={candidate.id}
                recipientEmail={candidate.email ?? null}
                bottomGapRem={26}
              />
            ) : tab === "notes" ? (
              <LocalNotesTab candidateId={candidate.id} />
            ) : (
              <EditableResume
                candidateRfId={null}
                candidateId={candidate.id}
                versions={resumeVersions}
                tokens={highlightTokens}
              />
            )}
            {/* Delete sits at the very bottom of the left column, Profile
                tab only - same component and placement as the full
                profile, restored to the split-view embed branch. */}
            {tab === "profile" && (
              <DeleteCandidateButton
                candidateId={candidate.id}
                candidateName={fullName}
              />
            )}
          </div>
          {/* Right rail. CompactOverview as a single tight summary box,
              then skills, then the call/email/text activity card. */}
          <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto">
            <CandidateCompactOverview
              candidateRef={candidate.id}
              fullName={fullName}
              firstName={candidate.firstName}
              lastName={candidate.lastName}
              currentDesignation={candidate.currentDesignation}
              currentOrganization={candidate.currentOrganization}
              location={candidate.location}
              email={candidate.email}
              phone={candidate.phone}
              altEmails={candidate.altEmails}
              altPhones={candidate.altPhones}
              linkedinProfile={candidate.linkedinProfile}
              expectedSalary={toExpectedSalary(candidate.expectedSalary)}
              highlightTokens={highlightTokens}
            />
            <LocalEditableSkills
              candidateId={candidate.id}
              initial={candidate.skills ?? []}
            />
            <CandidateActivityCard
              candidateId={candidate.id}
              toNumber={candidate.phone || null}
            />
          </aside>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6">
      {embed ? null : <CandidateProfileNav currentId={candidate.id} />}

      {/* Standalone name header was folded into the identity card at
          the top of the left column below so all candidate-identity
          info lives in one place (name + title + employer + contact +
          activity). h1 still anchors the page for SEO / a11y - it
          just renders inside the sidebar card now. */}

      {/* Section 2: Pipeline. LocalCandidateActions is rendered with
          hideButtons so its modals stay mounted (so per-row Submit
          deep-links and the header-button URL triggers still work)
          but its standalone Apply/Submit row doesn't render — header
          owns those entry points now. */}
      <LocalCandidateActions
        candidateId={candidate.id}
        candidateName={fullName}
        candidateFirstName={candidate.firstName}
        candidateEmail={candidate.email}
        candidateLocation={candidate.location}
        candidateCompensation={candidateCompensation}
        openJobs={openJobs}
        latestResumeName={latestResumeName}
        hideButtons
      />
      {/* Two-column layout. Left column is the working surface — a
          single sticky bundle (pipeline + tab strip + action row),
          then the tab content (Resume on Profile, AiWorkspace on
          Game Plan, notes editor on Notes). The right column is a
          tight reference rail (compact overview + skills + activity).
          Pipeline section moved INTO the left column so it shares
          a sticky wrapper with the tabs + action row — job pill
          headers now stay visible alongside Submit/Apply/Keep/Add
          when the recruiter scrolls deep into the resume. The
          redundant large identity card was dropped in favor of the
          single CompactOverview box. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          {/* Single sticky bundle: job pill rows on top, then
              Profile/Game Plan/Notes tabs aligned left + Submit/
              Apply/Keep/Add-to-List right-aligned with the resume's
              right edge. When the candidate has no placements
              LocalPlacementRows returns null and the sticky bar
              collapses to just the tabs + action row. flex-nowrap
              + min-w-0 on the action group ellipsizes labels rather
              than wrapping to a second row at narrow widths. */}
          <div className="sticky top-20 z-10 -mx-2 space-y-2 rounded-lg bg-court-bg/85 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-court-bg/75">
            {/* Pipeline section. LocalPlacementRows renders null when
                there are no placements, so the section is empty until
                the candidate is applied/submitted to a job. It stays
                mounted regardless so its apply-event listener is live
                and the first Apply-to-Job shows its pill immediately. */}
            <section id="pipeline">
              <LocalPlacementRows
                candidateId={candidate.id}
                candidateName={fullName}
                candidateEmail={candidate.email}
                candidatePhone={candidate.phone}
                candidateLocation={candidate.location}
                candidateCurrentTitle={candidate.currentDesignation}
                candidateCurrentEmployer={candidate.currentOrganization}
                recruiter={recruiter}
                jobs={jobRows}
              />
            </section>
            <div className="flex items-center justify-between gap-3">
              <UnderlineTabs tab={tab} candidateId={candidate.id} />
              {/* Submit removed from the action bar — the canonical
                  Submit entry point is the per-job-pill Submit
                  rendered by LocalPlacementRows above. */}
              <div className="flex min-w-0 shrink items-center gap-2">
                <Link
                  href={`/candidates/${candidate.id}?openApply=1`}
                  className={cn(APPLY_LINK_CLASS, "min-w-0")}
                  title="Apply to Job"
                >
                  <Target className="h-3 w-3 shrink-0" />
                  <span className="truncate">Apply to Job</span>
                </Link>
                <KeepCandidateButton
                  candidate={{ kind: "local", cuid: candidate.id }}
                  placements={keepPlacementSummaries}
                  openJobs={keepOpenJobs}
                  // Tab-chip size — matches the embed-view sibling above
                  // (see comment there).
                  className="min-w-0 gap-1 border-blue-400 px-2.5 py-1 text-[13px] dark:border-blue-500"
                />
                <AddToListButton
                  candidateId={candidate.id}
                  candidateName={fullName}
                  className="min-w-0 gap-1 border-court-fg-muted/50 px-2.5 py-1 text-[13px] font-medium"
                />
              </div>
            </div>
          </div>
          {tab === "game-plan" ? (
            <AiWorkspace
              entityType="candidate"
              entityId={candidate.id}
              recipientEmail={candidate.email ?? null}
              bottomGapRem={26}
            />
          ) : tab === "notes" ? (
            <LocalNotesTab candidateId={candidate.id} />
          ) : (
            <EditableResume
              candidateRfId={null}
              candidateId={candidate.id}
              versions={resumeVersions}
            />
          )}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <CandidateCompactOverview
            candidateRef={candidate.id}
            fullName={fullName}
            firstName={candidate.firstName}
            lastName={candidate.lastName}
            currentDesignation={candidate.currentDesignation}
            currentOrganization={candidate.currentOrganization}
            location={candidate.location}
            email={candidate.email}
            phone={candidate.phone}
            altEmails={candidate.altEmails}
            altPhones={candidate.altPhones}
            linkedinProfile={candidate.linkedinProfile}
            expectedSalary={toExpectedSalary(candidate.expectedSalary)}
          />
          <LocalEditableSkills
            candidateId={candidate.id}
            initial={candidate.skills ?? []}
          />
          <CandidateActivityCard
            candidateId={candidate.id}
            toNumber={candidate.phone || null}
          />
        </div>
      </div>

      {/* Delete lives inline at the very bottom of the page content and
          only on the Profile tab - not floating, and never on Game Plan
          or Notes. */}
      {tab === "profile" && (
        <DeleteCandidateButton candidateId={candidate.id} candidateName={fullName} />
      )}
    </div>
  );
}


async function LocalNotesTab({ candidateId }: { candidateId: string }) {
  const notes = await getNotesForEntity("candidate", candidateId);
  return <CandidateNotesPanel candidateId={candidateId} initialNotes={notes} />;
}

// Anchor-shaped twins of the shared Button "apply" / "secondary" variants.
// Used for the candidate-level action row above the resume so the buttons
// pick up the same Court Mode tokens as <Button> without nesting a
// <button> inside an <a> (Link wraps an <a>).
// Anchor-shaped twin of <Button variant="apply">. Token classes mirror
// the amber apply variant so the Apply to Job link renders identically
// to the matching <Button> without nesting a <button> inside an <a>.
// Border bumped from amber-200 → amber-400 so the chip sits at the
// same visual border weight as Submit to Job (the candidate-profile
// action row should read with the same border prominence across
// every button).
// Sized to match the TabStrip chips (Profile / Game Plan / Notes) sitting
// next to this button on the candidate-profile action row — same px-2.5
// py-1, text-[13px], gap-1 — so the three actions read at the same scale
// as the tabs they share the row with. Visual weight (amber-400 border,
// amber-50 fill, font-semibold) is untouched.
const APPLY_LINK_CLASS =
  "inline-flex items-center justify-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-2.5 py-1 text-[13px] font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60";

function UnderlineTabs({
  tab,
  candidateId,
  embed = false,
}: {
  tab: LocalCandidateTab;
  candidateId: string;
  // When true, every tab href carries embed=true so the iframe stays in
  // embed mode after a tab switch instead of breaking out to the
  // full-page layout.
  embed?: boolean;
}) {
  const embedPrefix = embed ? "embed=true&" : "";
  return (
    <TabStrip<LocalCandidateTab>
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
