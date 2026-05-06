import Link from "next/link";
import { notFound } from "next/navigation";
import { Link2, Mail, MapPin, Phone, Send, Target } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { getRfClientsForOrg, getRfContactsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { LocalCandidateActions, type LocalOpenJob } from "@/app/candidates/[id]/local-candidate-actions";
import { LocalPlacementRows, type LocalJobRow, type LocalInterview } from "@/app/candidates/[id]/local-placement-rows";
import { listAceTeam } from "@/lib/ace-team";
import { LocalEmployment } from "@/app/candidates/[id]/local-employment";
import { CandidateActivityCard } from "@/components/candidate-activity-card";
import { CandidateProfileNav } from "@/components/candidate-profile-nav";
import AiWorkspace from "@/components/AiWorkspace";
import { cn } from "@/lib/utils";
import { formatLocation } from "@/lib/utils";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
// 5A.5.b parity: Ace-native candidates now share the same resume
// management UI as RF-imported (multi-version dropdown, inline rename,
// redact, brand). The inline single-resume preview was retired.
import { EditableResume, type ResumeVersion } from "@/app/candidates/[id]/editable-resume";
import { AddToListButton } from "@/components/lists/add-to-list-button";
import { DeleteCandidateButton } from "@/app/candidates/[id]/delete-candidate-button";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPlacementsForOrg } from "@/lib/placements";
import { getInterviewsForOrg } from "@/lib/interviews";
import { getAppPreferences } from "@/lib/preferences";

type Exp = { designation?: string; organization?: string; from_year?: number | null; to_year?: number | null; description?: string };
type Edu = { school?: string; degree?: string; from_year?: number | null; to_year?: number | null; description?: string };

type LocalCandidateTab = "profile" | "game-plan" | "notes";

export async function LocalCandidateProfile({ id, tab: tabParam }: { id: string; tab?: string }) {
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
        notes: true,
        experience: true,
        education: true,
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
  const experience = (candidate.experience as unknown as Exp[] | null) ?? [];
  const education = (candidate.education as unknown as Edu[] | null) ?? [];

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

  const locationLabel = formatLocation(candidate.location);

  return (
    <div className="space-y-6">
      <CandidateProfileNav currentId={candidate.id} />

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

      {/* Two-column main. Same shape as the RF page: left is the
          consolidated identity sidebar (name + title + employer +
          contact + activity); right is the sticky tabs / actions
          toolbar plus tab content. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <aside className="space-y-4 lg:col-span-3">
          {/* Identity card. Folds the old standalone header into the
              top of the sidebar so name + title + employer sit right
              above Contact / Employment / Activity. h1 stays for SEO
              / a11y; only the visual treatment changes. */}
          <div className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
            <h1 className="break-words font-serif text-2xl font-bold leading-tight text-court-fg">
              {fullName}
            </h1>
            {(candidate.currentDesignation || locationLabel) && (
              <div className="mt-1 text-sm text-court-fg-muted">
                {[candidate.currentDesignation, locationLabel].filter(Boolean).join(" · ")}
              </div>
            )}
            {candidate.currentOrganization && (
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-court-accent-dark">
                Currently at {candidate.currentOrganization}
              </div>
            )}
          </div>
          <section className="rounded-2xl border border-court-border bg-court-surface p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-court-fg">Contact</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm">
              <Row
                icon={<Mail className="h-3.5 w-3.5" />}
                label="Email"
                value={candidate.email}
                render={(v) =>
                  candidate.email ? (
                    <EmailPopupLauncher
                      email={candidate.email}
                      className="hover:underline"
                      candidateRef={candidate.id}
                      context={{
                        candidate: {
                          firstName: candidate.firstName,
                          lastName: candidate.lastName,
                          email: candidate.email,
                          currentTitle: candidate.currentDesignation,
                          currentCompany: candidate.currentOrganization,
                        },
                      }}
                    >
                      {v}
                    </EmailPopupLauncher>
                  ) : (
                    <>{v}</>
                  )
                }
              />
              <Row icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={candidate.phone} href={candidate.phone ? `tel:${candidate.phone}` : null} />
              <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={locationLabel || null} />
              <Row icon={<Link2 className="h-3.5 w-3.5" />} label="LinkedIn" value={candidate.linkedinProfile} href={candidate.linkedinProfile} />
            </dl>
          </section>
          <LocalEmployment
            candidateId={candidate.id}
            initialDesignation={candidate.currentDesignation}
            initialOrganization={candidate.currentOrganization}
          />
          <CandidateActivityCard candidateId={candidate.id} toNumber={candidate.phone || null} />
        </aside>

        <div className="space-y-4 lg:col-span-7">
          {/* Sticky tab + actions toolbar. top-20 clears the AppShell
              h-20 topbar so Apply / Submit / Add to List stay
              reachable while the recruiter scrolls the resume.
              backdrop-blur + translucent bg keeps the row from looking
              like a hard banner over content underneath. ?openApply=1
              / ?openSubmit=1 deep-link into the LocalCandidateActions
              modals (mounted with hideButtons). */}
          <div className="sticky top-20 z-10 -mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-court-bg/85 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-court-bg/75">
            <UnderlineTabs tab={tab} candidateId={candidate.id} />
            <div className="flex shrink-0 items-center gap-2">
              <AddToListButton candidateId={candidate.id} candidateName={fullName} />
              <Link
                href={`/candidates/${candidate.id}?openApply=1`}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-800 shadow-sm transition hover:bg-amber-200"
              >
                <Target className="h-3 w-3" /> Apply to Job
              </Link>
              <Link
                href={`/candidates/${candidate.id}?openSubmit=1`}
                className="inline-flex items-center gap-1.5 rounded-md border border-court-brand bg-court-brand-tint px-2.5 py-1.5 text-xs font-medium text-court-brand-dark shadow-sm transition hover:bg-court-brand/25"
              >
                <Send className="h-3 w-3" /> Submit to different job
              </Link>
            </div>
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
            <div className="space-y-4">
              <EditableResume
                candidateRfId={null}
                candidateId={candidate.id}
                versions={resumeVersions}
              />
              {candidate.skills.length > 0 && (
                <ProfileAccordion title="Skills">
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.skills.map((s) => (
                      <span key={s} className="rounded-full border border-court-border bg-court-surface-subtle/60 px-2.5 py-0.5 text-xs text-court-fg">
                        {s}
                      </span>
                    ))}
                  </div>
                </ProfileAccordion>
              )}
              {experience.length > 0 && (
                <ProfileAccordion title="Experience">
                  <ul className="space-y-3 text-sm">
                    {experience.map((r, i) => (
                      <li key={`exp-${i}`} className="rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2">
                        <div className="font-medium text-court-fg">
                          {r.designation || "(role)"}{" "}
                          <span className="font-normal text-court-fg-muted">· {r.organization || "(employer)"}</span>
                        </div>
                        <div className="text-[11px] text-court-fg-muted">
                          {[r.from_year, r.to_year ?? "present"].filter((x) => x !== null && x !== undefined).join(" – ") || "—"}
                        </div>
                        {r.description && <p className="mt-1 text-xs text-court-fg-muted">{r.description}</p>}
                      </li>
                    ))}
                  </ul>
                </ProfileAccordion>
              )}
              {education.length > 0 && (
                <ProfileAccordion title="Education">
                  <ul className="space-y-3 text-sm">
                    {education.map((r, i) => (
                      <li key={`edu-${i}`} className="rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2">
                        <div className="font-medium text-court-fg">
                          {r.degree || "(degree)"}{" "}
                          <span className="font-normal text-court-fg-muted">· {r.school || "(school)"}</span>
                        </div>
                        <div className="text-[11px] text-court-fg-muted">
                          {[r.from_year, r.to_year].filter((x) => x !== null && x !== undefined).join(" – ") || "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </ProfileAccordion>
              )}
            </div>
          )}
        </div>
      </div>

      <DeleteCandidateButton candidateId={candidate.id} candidateName={fullName} />
    </div>
  );
}

// Native <details> gives free open/close + keyboard a11y. Mirror of the
// RF-imported page's accordion so both paths use the same shell.
function ProfileAccordion({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-court-border bg-court-surface shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3">
        <span className="font-serif text-base font-semibold text-court-fg">{title}</span>
        <span className="text-xs text-court-fg-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-court-border p-5">{children}</div>
    </details>
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
    <section className="rounded-xl border border-court-border bg-court-surface shadow-sm">
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

function Row({
  icon,
  label,
  value,
  href,
  render,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  href?: string | null;
  // Optional custom render override, used by the email row to inject
  // the click-to-email popup while keeping the label+dash treatment
  // consistent with plain rows.
  render?: (value: string) => React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-court-fg-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-court-fg">
        {value ? (
          render ? (
            render(value)
          ) : href ? (
            <a href={href} className="hover:underline" target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-court-fg-muted">—</span>
        )}
      </dd>
    </div>
  );
}
