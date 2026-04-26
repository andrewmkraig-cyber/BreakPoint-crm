import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Link2, Mail, MapPin, Phone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { normalizeJob, normalizeClient } from "@/lib/rf-payload-shapes";
import { getRfClientsForOrg, getRfContactsForOrg, getRfJobsForOrg } from "@/lib/candidates";
import { LocalCandidateActions, type LocalOpenJob } from "@/app/candidates/[id]/local-candidate-actions";
import { LocalPlacementRows, type LocalJobRow, type LocalInterview } from "@/app/candidates/[id]/local-placement-rows";
import { listAceTeam } from "@/lib/ace-team";
import { LocalEmployment } from "@/app/candidates/[id]/local-employment";
import { ActivityPanel, type ActivityInterview } from "@/app/candidates/[id]/activity-panel";
import { formatLocation } from "@/lib/utils";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";
// 5A.5.b parity: Ace-native candidates now share the same resume
// management UI as RF-imported (multi-version dropdown, inline rename,
// redact, brand). The inline single-resume preview was retired.
import { EditableResume, type ResumeVersion } from "@/app/candidates/[id]/editable-resume";
import { AddToListButton } from "@/components/lists/add-to-list-button";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPlacementsForOrg } from "@/lib/placements";
import { getInterviewsForOrg } from "@/lib/interviews";
import { getAppPreferences } from "@/lib/preferences";

type Exp = { designation?: string; organization?: string; from_year?: number | null; to_year?: number | null; description?: string };
type Edu = { school?: string; degree?: string; from_year?: number | null; to_year?: number | null; description?: string };

export async function LocalCandidateProfile({ id }: { id: string }) {
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

  // Flatten interviews into ActivityPanel rows. Job titles come from the
  // jobRows we already built so the history shows "Tax Manager" not a
  // bare timestamp.
  const titleByJob = new Map<number, string>();
  for (const j of jobRows) titleByJob.set(j.jobRfId, j.jobTitle);
  const activityInterviews: ActivityInterview[] = interviews.map((iv) => {
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

  return (
    <div className="space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1 text-xs text-court-fg-muted hover:text-court-fg">
        <ArrowLeft className="h-3 w-3" /> Back to candidates
      </Link>

      <PageHeader
        eyebrow="Ace candidate"
        title={fullName}
        description={
          candidate.currentDesignation || candidate.currentOrganization
            ? `${candidate.currentDesignation ?? ""}${candidate.currentDesignation && candidate.currentOrganization ? " · " : ""}${candidate.currentOrganization ?? ""}`
            : "Ace candidate."
        }
        actions={<AddToListButton candidateId={candidate.id} candidateName={fullName} />}
      />

      <LocalCandidateActions
        candidateId={candidate.id}
        candidateName={fullName}
        candidateFirstName={candidate.firstName}
        candidateEmail={candidate.email}
        openJobs={openJobs}
      />

      {jobRows.length > 0 && (
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
      )}

      {/* Resume-first layout: same split as the RF candidate page —
          ~70% resume / ~30% sidebar on lg+, so the recruiter opens the
          profile and lands directly on the document they came to read.
          5A.5.b: Ace-native uses the same EditableResume component as
          RF-imported, with full multi-version + rename + redact + brand
          parity. candidateRfId is null here; the component routes upload
          + delete by candidateId instead. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <section className="lg:col-span-7">
          <EditableResume
            candidateRfId={null}
            candidateId={candidate.id}
            versions={resumeVersions}
          />
        </section>

        <aside className="space-y-6 lg:col-span-3">
          <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
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
              <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={formatLocation(candidate.location) || null} />
              <Row icon={<Link2 className="h-3.5 w-3.5" />} label="LinkedIn" value={candidate.linkedinProfile} href={candidate.linkedinProfile} />
            </dl>
          </section>

          <LocalEmployment
            candidateId={candidate.id}
            initialDesignation={candidate.currentDesignation}
            initialOrganization={candidate.currentOrganization}
          />

          {candidate.skills.length > 0 && (
            <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-court-fg">Skills</h2>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {candidate.skills.map((s) => (
                  <span key={s} className="rounded-full border border-court-border bg-court-surface-subtle/60 px-2.5 py-0.5 text-xs text-court-fg">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {experience.length > 0 && (
            <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-court-fg">Experience</h2>
              <ul className="mt-3 space-y-3 text-sm">
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
            </section>
          )}

          {education.length > 0 && (
            <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-court-fg">Education</h2>
              <ul className="mt-3 space-y-3 text-sm">
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
            </section>
          )}

          {candidate.notes && (
            <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
              <h2 className="font-serif text-base font-semibold text-court-fg">Notes</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-court-fg">{candidate.notes}</p>
            </section>
          )}

          <section className="rounded-xl border border-court-border bg-court-surface p-5 shadow-sm">
            <h2 className="font-serif text-base font-semibold text-court-fg">About this record</h2>
            <dl className="mt-3 space-y-1 text-xs text-court-fg-muted">
              <div>
                <span className="font-medium text-court-fg">ID:</span>{" "}
                <span className="font-mono">{candidate.id}</span>
              </div>
              <div>
                <span className="font-medium text-court-fg">Created:</span>{" "}
                {candidate.createdAt.toLocaleString()}
              </div>
              <div>
                <span className="font-medium text-court-fg">Source:</span> Ace (local)
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <ActivityPanel interviews={activityInterviews} />
    </div>
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
