import Link from "next/link";
import { notFound } from "next/navigation";
import { NotebookPen, Target } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { getRfClientsForOrg, getRfContactsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { LocalCandidateActions, type LocalOpenJob } from "@/app/candidates/[id]/local-candidate-actions";
import { LocalPlacementRows, type LocalJobRow, type LocalInterview } from "@/app/candidates/[id]/local-placement-rows";
import { listAceTeam } from "@/lib/ace-team";
import { LocalEditableSkills } from "@/app/candidates/[id]/local-editable-skills";
import { CandidateActivityCard } from "@/components/candidate-activity-card";
import { CandidateProfileNav } from "@/components/candidate-profile-nav";
import { CandidateCompactOverview } from "@/components/candidate-compact-overview";
import { toExpectedSalary } from "@/components/candidate-overview-helpers";
import { TextHighlighter } from "@/components/text-highlighter";
import { parseHighlightTokens } from "@/app/candidates/[id]/highlight-tokens";
import AiWorkspace from "@/components/AiWorkspace";
import { cn } from "@/lib/utils";
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
        currentDesignation: true,
        currentOrganization: true,
        location: true,
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
    getPlacementsForOrg({ candidateId: id }),
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
  const aceTeam = await listAceTeam();
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

  const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "(unnamed)";

  // Embed = split-view iframe. Renders the same left column as the full
  // profile (compact overview + action row + resume) and a 280px right
  // rail with skills + activity. The action row is the single source of
  // truth for Apply / Keep / Add to List / Add Note — the candidates-page
  // chrome bar dropped its Apply / Keep duplicates in favor of this row.
  // LocalCandidateActions mounts with hideButtons so its modals stay
  // alive (Apply dialog + searchParams trigger) without rendering a
  // second visible button row.
  if (embed) {
    const highlightTokens = parseHighlightTokens(highlight);
    const isKeptEmbed = (candidate.tags ?? []).some((t) => {
      const lower = t.trim().toLowerCase();
      return lower === "kept" || lower === "keep";
    });
    // Same openJobs assembly as the non-embed branch below — embed needs
    // it so LocalCandidateActions has a list to render in its Apply
    // modal. Kept inline (small enough to not warrant a helper) and
    // tolerant of empty fetches so a Neon hiccup doesn't 500 the iframe.
    const linkedByRfJobE = new Map<number, string>();
    const linkedByAceJobE = new Map<string, string>();
    for (const p of placements) {
      if (p.jobRfId != null) linkedByRfJobE.set(p.jobRfId, p.stage);
      else if (p.jobId) linkedByAceJobE.set(p.jobId, p.stage);
    }
    const clientByIdE = new Map<number, (typeof allClients)[number]>();
    for (const cl of allClients) clientByIdE.set(cl.id, cl);
    const openJobsEmbed: LocalOpenJob[] = allJobs
      .filter((j) => j.is_open !== false)
      .map((raw) => {
        const j = normalizeJob(raw);
        const client = j.companyId != null ? clientByIdE.get(j.companyId) : null;
        const aceJobId = (raw as { _aceJobId?: string })._aceJobId ?? null;
        const aceClientId = (raw as { _aceClientId?: string })._aceClientId ?? null;
        const clientContacts = j.companyId != null
          ? allContacts
              .filter((ct) => ct.client_company_id === j.companyId)
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
          ? linkedByAceJobE.has(aceJobId)
          : linkedByRfJobE.has(j.id);
        const linkedStage = aceJobId
          ? linkedByAceJobE.get(aceJobId) ?? null
          : linkedByRfJobE.get(j.id) ?? null;
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
          openJobs={openJobsEmbed}
          hideButtons
        />
        <div className="flex h-[calc(100vh-3rem)] gap-4 md:h-[calc(100vh-4rem)]">
          {/* Left column. Resume sits as high as possible — the action
              row above it is the only thing between the iframe top and
              the resume PDF. CompactOverview moved to the right rail
              so it's not duplicated against the resume header. */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/candidates/${candidate.id}?embed=true&openApply=1`}
                className={APPLY_LINK_CLASS}
              >
                <Target className="h-3 w-3" /> Apply to Job
              </Link>
              <KeepCandidateButton candidateId={candidate.id} isKept={isKeptEmbed} />
              <Link
                href={`/candidates/${candidate.id}?tab=notes`}
                target="_top"
                className={ADD_NOTE_LINK_CLASS}
              >
                <NotebookPen className="h-3 w-3" /> Add Note
              </Link>
              <AddToListButton candidateId={candidate.id} candidateName={fullName} />
            </div>
            <EditableResume
              candidateRfId={null}
              candidateId={candidate.id}
              versions={resumeVersions}
              tokens={highlightTokens}
            />
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

  const openJobs: LocalOpenJob[] = allJobs
    .filter((j) => j.is_open !== false)
    .map((raw) => {
      const j = normalizeJob(raw);
      const client = j.companyId != null ? clientById.get(j.companyId) : null;
      // Ace-native Jobs ride the broadened getRfJobsForOrg shim with
      // _aceJobId + _aceClientId tucked onto the payload. Carry those
      // through to LocalOpenJob so submit/apply writes can set the
      // cuid FKs on Placement (and leave jobRfId / clientRfId null).
      const aceJobId = (raw as { _aceJobId?: string })._aceJobId ?? null;
      const aceClientId = (raw as { _aceClientId?: string })._aceClientId ?? null;
      // Filter the contact list to this job's client so the Submit
      // modal's To/Cc picker only surfaces relevant people. Mirrors
      // the shape the RF-imported Submit flow uses in placement-flows.
      const clientContacts = j.companyId != null
        ? allContacts
            .filter((ct) => ct.client_company_id === j.companyId)
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
    });
    interviewsByJob.set(key, list);
  }

  const jobRows: LocalJobRow[] = placements.map((p) => {
    // Find the RF-shaped Job payload by whichever identity the
    // Placement row carries. Ace-native placements match via the
    // shim's _aceJobId tag; RF-imported placements match via numeric id.
    const rfJob = p.jobRfId != null
      ? allJobs.find((j) => j.id === p.jobRfId) ?? null
      : p.jobId
        ? allJobs.find((j) => (j as { _aceJobId?: string })._aceJobId === p.jobId) ?? null
        : null;
    const job = rfJob ? normalizeJob(rfJob) : null;
    const clientRaw = p.clientRfId != null ? clientById.get(p.clientRfId) ?? null : null;
    const client = clientRaw ? normalizeClient(clientRaw) : null;
    const clientContacts = p.clientRfId != null
      ? allContacts
          .filter((ct) => ct.client_company_id === p.clientRfId)
          .map((ct) => {
            const firstEmail = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
            const fullName = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
            return { id: ct.id, name: fullName, title: ct.current_designation ?? "", email: firstEmail };
          })
      : [];
    const rawDescription = typeof rfJob?.description === "string" ? rfJob.description : "";
    const interviewKey = p.jobRfId != null ? `rf:${p.jobRfId}` : p.jobId ? `ace:${p.jobId}` : "";
    return {
      placementId: p.id,
      // LocalPlacementRows keeps a numeric jobRfId prop. Ace-native rows
      // surface their synthetic id (from rfJob.id when available) or 0
      // as a fallback; write paths key on the placementId anyway.
      jobRfId: p.jobRfId ?? (rfJob?.id ?? 0),
      jobTitle: job?.title ?? "(job)",
      jobLocation: job?.location ?? "",
      jobDescription:
        (p.jobRfId != null ? overrideByJob.get(p.jobRfId) : null) ??
        rawDescription,
      jobSalaryRange: job?.compensation ?? "",
      clientRfId: p.clientRfId ?? 0,
      clientName: client?.name ?? job?.company ?? "",
      clientWebsite: client?.website ?? "",
      clientLinkedIn: client?.linkedIn ?? "",
      clientContacts,
      stage: p.stage,
      interviews: interviewsByJob.get(interviewKey) ?? [],
    };
  });

  const recruiter = (() => {
    const email = session?.user?.email ?? "";
    const fullName = session?.user?.name ?? "";
    const firstName = fullName.split(/\s+/)[0] ?? "";
    const phone = email
      ? prefs.recruiterPhones[email] ?? prefs.recruiterPhones[email.toLowerCase()] ?? ""
      : "";
    return { firstName, fullName, email, phone };
  })();

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
        openJobs={openJobs}
        hideButtons
      />
      {/* Pipeline section only renders when there are placements.
          Header was removed — the row card already shows the job +
          stage chip, and the redundant "Pipeline · N" label above
          was just visual noise. */}
      {jobRows.length > 0 && (
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
            aceTeam={aceTeam}
          />
        </section>
      )}

      {/* Two-column layout. Left column is the working surface — the
          Profile/Game Plan/Notes tab strip, then the action row, then
          the tab content (Resume on Profile, AiWorkspace on Game Plan,
          notes editor on Notes). The right column is a tight reference
          rail (compact overview + skills + activity). The redundant
          large identity card was dropped in favor of the single
          CompactOverview box. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <div className="sticky top-20 z-10 -mx-2 flex flex-wrap items-center gap-3 rounded-lg bg-court-bg/85 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-court-bg/75">
            <UnderlineTabs tab={tab} candidateId={candidate.id} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/candidates/${candidate.id}?openApply=1`}
              className={APPLY_LINK_CLASS}
            >
              <Target className="h-3 w-3" /> Apply to Job
            </Link>
            <KeepCandidateButton
              candidateId={candidate.id}
              isKept={(candidate.tags ?? []).some((t) => {
                const lower = t.trim().toLowerCase();
                return lower === "kept" || lower === "keep";
              })}
            />
            <Link
              href={`/candidates/${candidate.id}?tab=notes`}
              className={ADD_NOTE_LINK_CLASS}
            >
              <NotebookPen className="h-3 w-3" /> Add Note
            </Link>
            <AddToListButton candidateId={candidate.id} candidateName={fullName} />
          </div>
          {tab === "game-plan" ? (
            <AiWorkspace
              entityType="candidate"
              entityId={candidate.id}
              recipientEmail={candidate.email ?? null}
            />
          ) : tab === "notes" ? (
            <LocalNotesTab
              candidateId={candidate.id}
              initialNotes={candidate.notes}
            />
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

      <DeleteCandidateButton candidateId={candidate.id} candidateName={fullName} />
    </div>
  );
}


function LocalNotesTab({
  candidateId,
  initialNotes,
}: {
  candidateId: string;
  initialNotes: string | null;
}) {
  return (
    <section className="rounded-xl border border-court-border/40 bg-court-surface shadow-sm">
      <header className="border-b border-court-border px-5 py-3">
        <h2 className="font-serif text-base font-semibold text-court-fg">
          Notes
        </h2>
        <p className="mt-0.5 text-xs text-court-fg-muted">
          Recruiter notes attached to this candidate. Newest at the top.
        </p>
      </header>
      <div className="p-5">
        {initialNotes ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-court-fg">
            {initialNotes}
          </pre>
        ) : (
          <p className="text-sm text-court-fg-muted">
            No notes yet. Use the green + button in the top bar to add one.
          </p>
        )}
        {/* Note: this read-only view is intentional for Ace-native
            candidates today — the RF EditableNotes component still
            relies on the legacy numeric-id update path. New notes
            should land via the FAB Notes popup which writes through
            POST /api/notes (cuid-aware). */}
        <input type="hidden" data-candidate-id={candidateId} />
      </div>
    </section>
  );
}

// Anchor-shaped twins of the shared Button "apply" / "secondary" variants.
// Used for the candidate-level action row above the resume so the buttons
// pick up the same Court Mode tokens as <Button> without nesting a
// <button> inside an <a> (Link wraps an <a>).
// Anchor-shaped twin of <Button variant="apply">. Token classes mirror
// the amber apply variant so the Apply to Job link renders identically
// to the matching <Button> without nesting a <button> inside an <a>.
const APPLY_LINK_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60";

const ADD_NOTE_LINK_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1.5 text-xs font-semibold text-court-fg shadow-sm transition hover:bg-court-surface";

function UnderlineTabs({ tab, candidateId }: { tab: LocalCandidateTab; candidateId: string }) {
  // Segmented-control pill row. Active tab is a lifted white pill inside
  // a muted track so it stands out next to the small "PIPELINE · 0" label
  // that previously dominated the row visually. Inactive tabs are muted
  // text only — hover lightens to fg.
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface p-1 shadow-sm">
      <UnderlineTabLink label="Profile" href={`/candidates/${candidateId}`} active={tab === "profile"} />
      <UnderlineTabLink label="Game Plan" href={`/candidates/${candidateId}?tab=game-plan`} active={tab === "game-plan"} />
      <UnderlineTabLink label="Notes" href={`/candidates/${candidateId}?tab=notes`} active={tab === "notes"} />
    </div>
  );
}

function UnderlineTabLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "bg-court-accent-tint text-court-accent-dark ring-1 ring-court-accent/40"
          : "text-court-fg-muted hover:bg-court-surface-subtle hover:text-court-fg",
      )}
    >
      {label}
    </Link>
  );
}

