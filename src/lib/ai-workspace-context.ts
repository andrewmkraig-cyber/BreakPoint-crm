import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getNotesForEntity } from "@/lib/notes/queries";
import { prisma } from "@/lib/prisma";
import { callLineWhere, getQuoLineDigitsForUserEmail, smsLineWhere } from "@/lib/quo-line-owner";
import { canonicalStage } from "@/lib/rf-payload-shapes";
import { getResumeBytes } from "@/lib/resume-bytes";
import { formatInterviewWhen } from "@/lib/interview-format";
import { DEFAULT_INTERVIEW_TIMEZONE } from "@/lib/timezones";
import { formatExpectedCompensation } from "@/lib/candidate-compensation";

// Builds the system prompt for the per-entity AI workspace and Claude
// Panel chats. Every read is Neon-cuid-keyed: RecruiterFlow was retired
// at the Phase 1 cutover, so context is sourced exclusively from the
// Ace-native tables (Candidate, Client, Job, Placement, Contact,
// ClientAgreement, ClientBenefits, JobOverride, CandidateResume).
// Callers are expected to pre-resolve any legacy numeric URL segment
// to a cuid before invoking these builders (see getClientByIdentifier
// / getJobByIdentifier / getCandidateByIdentifier in the per-entity
// lib files).
//
// Resume text: the schema doesn't store parsed PDF text, so this
// module pdf-parses the most-recent CandidateResume blob on demand
// (extractResumeTextForCandidate). The structured "RESUME:" block
// stays in candidate context as a fallback for candidates with no
// uploaded PDF — together they give Claude either the actual resume
// narrative or the structured profile, never neither.

// Candidate-context Game Plan sends the full resume + full JDs so
// Claude gets the whole story, not a 3k-char summary. Client-context
// loops over every candidate in pipeline though, so per-candidate
// resume stays capped to prevent a 20-candidate client from blowing
// up the prompt. 10k/candidate gives ~3x the old cap and still keeps
// total payload under the 60s function budget for wide pipelines.
const CLIENT_LOOP_RESUME_MAX_CHARS = 10_000;
const RECENT_CALL_CONTEXT_TAKE = 5;
const CALL_SUMMARY_MAX_CHARS = 1200;
const CALL_TRANSCRIPT_MAX_CHARS = 3500;
const COPY_READY_RESPONSE_STYLE =
  "Respond with copy-ready text. For structured outputs, use clean markdown: bold section headers like **Header:** and hyphen bullets for list-like content. Do not use markdown tables or code fences.";

type CallContextRow = Prisma.CallLogGetPayload<{ include: { transcript: true } }>;

export async function buildCandidateCallContextBlock(input: {
  candidateId: string;
  organizationId: string;
  userEmail?: string | null;
  heading?: string;
  take?: number;
}): Promise<string> {
  const lineDigits = await getQuoLineDigitsForUserEmail(
    input.organizationId,
    input.userEmail,
  );
  return buildRecentCallContextBlock({
    organizationId: input.organizationId,
    lineDigits,
    where: { candidateId: input.candidateId },
    heading:
      input.heading ??
      "RECENT CALL CONTEXT (AI summaries and transcript excerpts)",
    take: input.take,
  });
}

export async function buildClientContext(clientId: string): Promise<string> {
  const org = await getCurrentOrg();
  const session = await getServerSession(authOptions);
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session?.user?.email);

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: org.id },
  });

  if (!client) {
    return "You are an AI recruiting assistant for BreakPoint Talent. No client was found for the requested record.";
  }

  const companyName = client.name || "(unknown company)";

  const [jobs, contacts, agreements, benefits, placements] = await Promise.all([
    prisma.job.findMany({
      where: { clientId: client.id, organizationId: org.id },
      include: { override: { select: { description: true } } },
      orderBy: [{ isOpen: "desc" }, { title: "asc" }],
    }),
    prisma.contact.findMany({
      where: { clientId: client.id, organizationId: org.id },
      orderBy: [{ name: "asc" }, { firstName: "asc" }],
    }),
    prisma.clientAgreement.findMany({
      where: {
        clientId: client.id,
        organizationId: org.id,
        uploadComplete: true,
      },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.clientBenefits.findUnique({ where: { clientId: client.id } }),
    prisma.placement.findMany({
      where: { clientId: client.id, organizationId: org.id },
      include: {
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            currentDesignation: true,
            currentOrganization: true,
            skills: true,
            notes: true,
            experience: true,
            education: true,
          },
        },
      },
    }),
  ]);

  // Pipeline grouping by job. Placements without a job cuid are skipped
  // because they can't be assigned to a row in the JOBS section anyway;
  // the standalone PLACEMENTS block below still surfaces them.
  type PipelineCandidate = (typeof placements)[number]["candidate"];
  type PipelineEntry = {
    name: string;
    stage: string;
    candidate: PipelineCandidate;
  };
  const candidatesByJob = new Map<string, PipelineEntry[]>();
  for (const p of placements) {
    if (!p.jobId) continue;
    const candidate = p.candidate;
    const candidateName = candidate
      ? [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
        "(unnamed)"
      : "(unknown candidate)";
    const list = candidatesByJob.get(p.jobId) ?? [];
    list.push({ name: candidateName, stage: p.stage, candidate });
    candidatesByJob.set(p.jobId, list);
  }

  function countByBucket(list: PipelineEntry[]): Record<string, number> {
    const counts: Record<string, number> = {
      applied: 0,
      submitted: 0,
      interviewing: 0,
      kept: 0,
      offer: 0,
      hired: 0,
      rejected: 0,
    };
    for (const c of list) {
      const b = canonicalStage(c.stage);
      if (b in counts) counts[b] += 1;
    }
    return counts;
  }

  const activeJobs = jobs.filter((j) => j.isOpen !== false);
  const clientCallContextOr: Prisma.CallLogWhereInput[] = [{ clientId: client.id }];
  const clientPipelineCandidateIds = Array.from(
    new Set(placements.map((p) => p.candidate?.id).filter((id): id is string => Boolean(id))),
  );
  if (clientPipelineCandidateIds.length > 0) {
    clientCallContextOr.push({ candidateId: { in: clientPipelineCandidateIds } });
  }
  const clientCallContextBlock = await buildRecentCallContextBlock({
    organizationId: org.id,
    lineDigits,
    where: { OR: clientCallContextOr },
    heading:
      "RECENT CLIENT/PIPELINE CALL CONTEXT (AI summaries and transcript excerpts)",
  });

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage the account for ${companyName}. ${COPY_READY_RESPONSE_STYLE} Write as if composing a text message or email that can be copied and sent directly. Always use proper punctuation including commas between city and state (e.g. Springfield, OH - never Springfield OH). Be concise, commercially sharp, and direct - no filler. Reference the data below automatically. Andrew should never have to paste context into this chat. NEVER include signature lines (Andrew Kraig, BreakPoint Talent, title lines, contact info) anywhere in your response. Andrew's email signature is auto-appended by Ace when a bubble is sent through the Email this button, and adding one here doubles up every email. A short closing line on its own (Thanks, / Best, / Talk soon,) is fine and welcome at the end of email-style responses, but stop there. NEVER use em dashes (the long em-dash character, Unicode U+2014) in any response. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (the regular dash) are fine for compound words.`,
  );
  lines.push("");
  lines.push(
    `COMPANY: ${companyName} | ${client.domain || "(no website)"} | ${client.industry || "(no industry)"}`,
  );
  lines.push("");

  // Jobs block.
  lines.push(`JOBS (${activeJobs.length} active):`);
  for (const job of jobs) {
    const statusLabel = job.isOpen ? "Active" : "Closed";
    const list = candidatesByJob.get(job.id) ?? [];
    const c = countByBucket(list);
    const placementCount = placements.filter(
      (p) =>
        p.jobId === job.id &&
        (p.stage === "hired" || p.stage === "pending_start"),
    ).length;
    const location =
      job.locations.length > 0 ? job.locations.join(", ") : "(no location)";
    lines.push(`  ${job.title} - ${location} - ${statusLabel}`);
    lines.push(
      `  Pipeline: Applied(${c.applied}) Submitted(${c.submitted}) Interview(${c.interviewing}) Kept(${c.kept}) Offer(${c.offer}) Placement(${placementCount})`,
    );
    if (list.length > 0) {
      const names = list.map((x) => `${x.name} (${x.stage})`).join(", ");
      lines.push(`  Candidates: ${names}`);
    }
    const description = resolveJobDescription(job);
    if (description) {
      lines.push("  Description:");
      for (const dLine of description.split("\n")) lines.push(`    ${dLine}`);
    }
    lines.push("");
  }

  // Candidate details: one Resume block per unique person across the
  // pipeline. Keeps the AI from needing to stitch metadata to content.
  const seenCandidateIds = new Set<string>();
  const uniqueCandidates: PipelineEntry[] = [];
  for (const list of Array.from(candidatesByJob.values())) {
    for (const entry of list) {
      if (!entry.candidate) continue;
      if (seenCandidateIds.has(entry.candidate.id)) continue;
      seenCandidateIds.add(entry.candidate.id);
      uniqueCandidates.push(entry);
    }
  }
  if (uniqueCandidates.length > 0) {
    lines.push("CANDIDATE DETAILS:");
    for (const entry of uniqueCandidates) {
      const resume = entry.candidate
        ? assembleResumeFromAce(entry.candidate)
        : "";
      const capped = truncate(resume, CLIENT_LOOP_RESUME_MAX_CHARS);
      lines.push(`  ${entry.name} (${entry.stage})`);
      lines.push("    Resume:");
      if (capped.trim()) {
        for (const rLine of capped.split("\n")) lines.push(`      ${rLine}`);
      } else {
        lines.push("      (no resume content on file)");
      }
    }
    lines.push("");
  }

  // Contacts block.
  lines.push("CONTACTS:");
  for (const ct of contacts) {
    const displayName =
      [ct.firstName, ct.lastName].filter(Boolean).join(" ") ||
      ct.name ||
      "(unnamed)";
    const email = ct.emails[0] ?? "";
    const phoneRaw = extractFirstPhone(ct.phoneNumbers);
    lines.push(
      `  ${displayName}, ${ct.currentDesignation || "(no title)"} - ${email || "(no email)"} | ${phoneRaw || "(no phone)"}`,
    );
  }
  if (contacts.length === 0) lines.push("  (none on file)");
  lines.push("");

  if (clientCallContextBlock) {
    lines.push(clientCallContextBlock);
    lines.push("");
  }

  // Agreements block.
  lines.push("AGREEMENTS:");
  if (agreements.length === 0) {
    lines.push("  (no uploaded agreement)");
  } else {
    for (const a of agreements) {
      lines.push(
        `  ${a.filename} - uploaded ${a.uploadedAt.toLocaleDateString()}${a.summary ? ` - summary: ${a.summary.slice(0, 160).trim()}${a.summary.length > 160 ? "…" : ""}` : ""}`,
      );
    }
  }
  const feeFromPlacement = placements.find((p) => p.feePercentage != null);
  const guaranteeFromPlacement = placements.find(
    (p) => p.guaranteePeriodDays != null,
  );
  if (
    feeFromPlacement?.feePercentage != null ||
    guaranteeFromPlacement?.guaranteePeriodDays != null
  ) {
    const fee =
      feeFromPlacement?.feePercentage != null
        ? `${feeFromPlacement.feePercentage}% fee`
        : null;
    const guarantee =
      guaranteeFromPlacement?.guaranteePeriodDays != null
        ? `${guaranteeFromPlacement.guaranteePeriodDays}-day guarantee`
        : null;
    lines.push(
      `  Terms (from placements): ${[fee, guarantee].filter(Boolean).join(", ")}`,
    );
  }
  lines.push("");

  // Benefits summary. The authoritative text lives on ClientBenefits.body
  // (either hand-authored or produced by the "Generate Summary" Claude
  // button on the Benefits tab). Embed it verbatim so the assistant
  // answers benefits questions from the stored summary instead of
  // re-parsing the raw carrier PDFs every turn.
  lines.push("BENEFITS SUMMARY:");
  const benefitsBody = benefits?.body?.trim() ?? "";
  if (benefitsBody) {
    for (const bLine of benefitsBody.split("\n")) lines.push(`  ${bLine}`);
  } else {
    lines.push(
      "  (no benefits summary on file - generate one on the Benefits tab)",
    );
  }
  lines.push("");

  // Placements block.
  lines.push("PLACEMENTS:");
  if (placements.length === 0) {
    lines.push("  (no placements on file)");
  } else {
    const jobsById = new Map(jobs.map((j) => [j.id, j]));
    for (const p of placements) {
      const candidateName = p.candidate
        ? [p.candidate.firstName, p.candidate.lastName]
            .filter(Boolean)
            .join(" ") || "(unnamed)"
        : "(unknown candidate)";
      const jobTitle = p.jobId
        ? (jobsById.get(p.jobId)?.title ?? "(unknown job)")
        : "(unknown job)";
      const when = p.startConfirmedAt ?? p.placedAt ?? p.offerReceivedAt;
      const whenStr = when ? ` - ${when.toLocaleDateString()}` : "";
      const amount = p.acceptedSalary ?? p.offerSalary;
      const money = amount != null ? ` - $${amount.toLocaleString()}` : "";
      lines.push(
        `  ${candidateName} → ${jobTitle} (${p.stage})${whenStr}${money}`,
      );
    }
  }

  // ACTIVE JOBS: original JD pastes for up-to-5 open roles. Sits next
  // to the JOBS block above (which lists titles + override
  // descriptions + pipeline counts) so Claude can ground answers in
  // the unmodified rawJobDescription text the recruiter saved.
  const activeJobsForJD = activeJobs
    .filter((j) => j.rawJobDescription?.trim())
    .slice(0, 5);
  if (activeJobsForJD.length > 0) {
    lines.push("");
    lines.push("ACTIVE JOBS (raw description):");
    for (const j of activeJobsForJD) {
      lines.push(`  ${j.title}`);
      const capped = truncate(j.rawJobDescription!.trim(), 2000);
      for (const dLine of capped.split("\n")) lines.push(`    ${dLine}`);
      lines.push("");
    }
  }

  // PIPELINE CANDIDATES: pdf-parsed resume text for the 10 most-
  // recently-updated placements. Distinct from CANDIDATE DETAILS
  // (which renders the structured assemble-from-Ace narrative) — this
  // surfaces the actual uploaded resume so Claude reads the recruiter's
  // submittals in the candidate's own words. Capped at 3k/candidate to
  // keep total payload under the 60s function budget for wide
  // pipelines. pdf-parse runs in parallel; silent fallback on any
  // failure (drops that candidate from the section).
  const recentPlacements = [...placements]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 10);
  const pipelineResumes = await Promise.all(
    recentPlacements.map(async (p) => {
      if (!p.candidate) return null;
      const name =
        [p.candidate.firstName, p.candidate.lastName]
          .filter(Boolean)
          .join(" ") || "(unnamed)";
      const text = await extractResumeTextForCandidate(
        p.candidate.id,
        org.id,
        3000,
      );
      if (!text) return null;
      return { name, stage: p.stage, text };
    }),
  );
  const pipelineResumesFiltered = pipelineResumes.filter(
    (x): x is { name: string; stage: string; text: string } => x !== null,
  );
  if (pipelineResumesFiltered.length > 0) {
    lines.push("");
    lines.push("PIPELINE CANDIDATES (uploaded resume text):");
    for (const e of pipelineResumesFiltered) {
      lines.push(`  ${e.name} (${e.stage})`);
      for (const rLine of e.text.split("\n")) lines.push(`    ${rLine}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function buildCandidateContext(
  candidateId: string,
): Promise<string> {
  const org = await getCurrentOrg();
  const session = await getServerSession(authOptions);
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session?.user?.email);

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, organizationId: org.id },
  });

  if (!candidate) {
    return "You are an AI recruiting assistant for BreakPoint Talent. No candidate was found for the requested record.";
  }

  const [smsMessages, callLogs, placements, interviews, recruiterNotes] =
    await Promise.all([
      prisma.smsMessage.findMany({
        where: { candidateId: candidate.id, organizationId: org.id, AND: [smsLineWhere(lineDigits)] },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.callLog.findMany({
        where: { candidateId: candidate.id, organizationId: org.id, AND: [callLineWhere(lineDigits)] },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { transcript: true },
      }),
      prisma.placement.findMany({
        where: { candidateId: candidate.id, organizationId: org.id },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              description: true,
              override: { select: { description: true } },
            },
          },
          client: { select: { id: true, name: true } },
        },
      }),
      prisma.interview.findMany({
        where: { candidateId: candidate.id, organizationId: org.id },
        orderBy: { scheduledAt: "desc" },
        take: 10,
        select: {
          id: true,
          scheduledAt: true,
          durationMin: true,
          type: true,
          status: true,
          location: true,
          notes: true,
          job: { select: { title: true } },
          client: { select: { name: true } },
        },
      }),
      // Notes from the new Note table (the modern multi-row recruiter
      // notes panel — distinct from the legacy `candidate.notes` text
      // column rendered as "PROFILE NOTES" further down). Already
      // scoped by organizationId + the requesting user's createdById
      // inside getNotesForEntity, matching the privacy model of the
      // /notes page.
      getNotesForEntity("candidate", candidate.id),
    ]);
  const candidateCallContextBlock = await buildRecentCallContextBlock({
    organizationId: org.id,
    lineDigits,
    where: { candidateId: candidate.id },
    heading:
      "RECENT CALL CONTEXT (AI summaries and transcript excerpts)",
  });

  // Activity feed: ActivityLog rows targeted at this candidate, plus
  // child rows logged against this candidate's placements or
  // interviews. Mirrors the per-entity feed at
  // /api/activity/[entityType]/[entityId]/route.ts so the assistant
  // and the on-screen activity panel agree about "what happened on
  // this candidate." Bounded to 30 most-recent rows so the prompt
  // doesn't blow up for chatty candidates.
  const placementIds = placements.map((p) => p.id);
  const interviewIds = interviews.map((i) => i.id);
  const activityOr: Prisma.ActivityLogWhereInput[] = [
    { targetType: "candidate", targetId: candidate.id },
  ];
  if (placementIds.length > 0) {
    activityOr.push({ targetType: "placement", targetId: { in: placementIds } });
  }
  if (interviewIds.length > 0) {
    activityOr.push({ targetType: "interview", targetId: { in: interviewIds } });
  }
  const activityRows = await prisma.activityLog.findMany({
    where: { organizationId: org.id, OR: activityOr },
    orderBy: { timestamp: "desc" },
    take: 30,
    select: {
      actionType: true,
      timestamp: true,
      targetType: true,
      metadata: true,
    },
  });

  const fullName =
    [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
    "(unnamed)";
  const title = candidate.currentDesignation ?? "";
  const employer = candidate.currentOrganization ?? "";
  const location = candidate.location ?? "";
  const email = candidate.email ?? "";
  const phone = candidate.phone ?? "";
  const skills = candidate.skills ?? [];
  const notes = candidate.notes ?? "";

  const compTarget = formatExpectedCompensation(candidate.expectedSalary);

  const resumeText = assembleResumeFromAce(candidate);
  const uploadedResumeText = await extractResumeTextForCandidate(
    candidate.id,
    org.id,
    6000,
  );

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage candidate ${fullName}. ${COPY_READY_RESPONSE_STYLE} Write as if composing a text message or email that can be copied and sent directly. Always use proper punctuation including commas between city and state (e.g. Springfield, OH - never Springfield OH). Be concise and direct. Reference the data below automatically. NEVER include signature lines (Andrew Kraig, BreakPoint Talent, title lines, contact info) anywhere in your response. Andrew's email signature is auto-appended by Ace when a bubble is sent through the Email this button, and adding one here doubles up every email. A short closing line on its own (Thanks, / Best, / Talk soon,) is fine and welcome at the end of email-style responses, but stop there. NEVER use em dashes (the long em-dash character, Unicode U+2014) in any response. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (the regular dash) are fine for compound words.`,
  );
  lines.push("");
  lines.push(
    `CANDIDATE: ${fullName}${title ? `, ${title}` : ""}${employer ? ` at ${employer}` : ""}`,
  );
  lines.push(`LOCATION: ${location || "(unknown)"}`);
  lines.push(`COMP TARGET: ${compTarget || "(not set)"}`);
  lines.push(`CONTACT: ${email || "(no email)"} | ${phone || "(no phone)"}`);
  if (skills.length > 0) lines.push(`SKILLS: ${skills.join(", ")}`);
  // PROFILE NOTES — the legacy `candidate.notes` single-string column
  // (typically an RF-imported bio / intake paragraph). Distinct from
  // the RECRUITER NOTES block below, which is the modern multi-row
  // Note table that powers the on-screen notes panel.
  if (notes)
    lines.push(
      `PROFILE NOTES: ${notes.slice(0, 300)}${notes.length > 300 ? "…" : ""}`,
    );
  lines.push("");

  // Work history + education promoted to their own labeled blocks so
  // Claude can retrieve them directly without parsing the RESUME
  // narrative below. Same data the resume block embeds — duplication
  // is intentional, the prompt is cheap, retrieval clarity is the win.
  const workHistoryLines = renderExperienceBlock(candidate.experience);
  lines.push("WORK HISTORY:");
  if (workHistoryLines.length > 0) {
    for (const wLine of workHistoryLines) lines.push(`  ${wLine}`);
  } else {
    lines.push("  (none on file)");
  }
  lines.push("");

  const educationLines = renderEducationBlock(candidate.education);
  lines.push("EDUCATION:");
  if (educationLines.length > 0) {
    for (const eLine of educationLines) lines.push(`  ${eLine}`);
  } else {
    lines.push("  (none on file)");
  }
  lines.push("");

  // Resume sections. UPLOADED RESUME is the pdf-parsed text from the
  // most-recent CandidateResume blob (capped at 6k chars). RESUME is
  // the structured fallback assembled from notes/experience/education
  // — kept so candidates without a PDF upload still surface a
  // near-resume narrative. Both can be present.
  lines.push("UPLOADED RESUME:");
  if (uploadedResumeText.trim()) {
    for (const rLine of uploadedResumeText.split("\n")) lines.push(`  ${rLine}`);
  } else {
    lines.push("  No resume on file");
  }
  lines.push("");

  lines.push("RESUME:");
  if (resumeText.trim()) {
    for (const rLine of resumeText.split("\n")) lines.push(`  ${rLine}`);
  } else {
    lines.push("  (no resume content on file)");
  }
  lines.push("");

  lines.push("ACTIVE APPLICATIONS:");
  if (placements.length === 0) {
    lines.push("  (none)");
  } else {
    for (const p of placements) {
      const jobTitle = p.job?.title ?? "(unknown job)";
      const clientName = p.client?.name ?? "(unknown client)";
      lines.push(`  JOB: ${jobTitle} at ${clientName} - Stage: ${p.stage}`);
      const description = p.job ? resolveJobDescription(p.job) : "";
      if (description) {
        lines.push(`  JOB DESCRIPTION:`);
        for (const dLine of description.split("\n")) lines.push(`    ${dLine}`);
      } else {
        lines.push(`  JOB DESCRIPTION: (none on file)`);
      }
      lines.push("");
    }
  }

  lines.push("INTERVIEWS (times shown in Eastern Time / ET; do not convert them):");
  if (interviews.length === 0) {
    lines.push("  (none on file)");
  } else {
    for (const iv of interviews) {
      const when = formatInterviewWhen(iv.scheduledAt, DEFAULT_INTERVIEW_TIMEZONE);
      const jobTitle = iv.job?.title ?? "(unknown role)";
      const clientName = iv.client?.name ?? "(unknown client)";
      const loc = iv.location?.trim() ? ` @ ${iv.location.trim()}` : "";
      lines.push(
        `  ${when} - ${iv.type} - ${iv.status} - ${jobTitle} at ${clientName} (${iv.durationMin}min)${loc}`,
      );
      if (iv.notes?.trim()) {
        const capped =
          iv.notes.length > 240 ? `${iv.notes.slice(0, 240)}…` : iv.notes;
        for (const nLine of capped.split("\n")) lines.push(`    ${nLine}`);
      }
    }
  }
  lines.push("");

  lines.push("RECRUITER NOTES:");
  if (recruiterNotes.length === 0) {
    lines.push("  (none on file)");
  } else {
    // Surfaced verbatim — pasted email threads, meeting recaps, and
    // outreach drafts routinely run multiple thousands of chars, and
    // truncating mid-sentence makes "read me her notes" answers
    // useless (Claude literally reports the cut: "The note cuts off
    // there with M..."). Bound by a total-block char budget rather
    // than per-note so one long note can't silently push later notes
    // off the prompt; the upstream `take: 20` row limit is the
    // secondary safety net. 50k chars ≈ 12.5k tokens, well under the
    // 200k context window for either Sonnet or Opus.
    const NOTES_TOTAL_CHAR_BUDGET = 50_000;
    let notesCharsUsed = 0;
    let notesDropped = 0;
    for (const n of recruiterNotes) {
      if (notesCharsUsed >= NOTES_TOTAL_CHAR_BUDGET) {
        notesDropped += 1;
        continue;
      }
      const when = n.updatedAt.toLocaleDateString();
      const pinned = n.pinned ? "pinned · " : "";
      const titlePart = n.title?.trim() ? ` - ${n.title.trim()}` : "";
      lines.push(`  [${pinned}${when}]${titlePart}`);
      for (const nLine of n.body.split("\n")) lines.push(`    ${nLine}`);
      notesCharsUsed += n.body.length;
    }
    if (notesDropped > 0) {
      lines.push(
        `  (${notesDropped} older note${notesDropped === 1 ? "" : "s"} omitted to fit prompt budget; ask for a specific date if you need them)`,
      );
    }
  }
  lines.push("");

  lines.push("ACTIVITY FEED:");
  if (activityRows.length === 0) {
    lines.push("  (no logged activity)");
  } else {
    for (const a of activityRows) {
      const when = a.timestamp.toISOString().slice(0, 10);
      const metaStr = renderActivityMetadata(a.metadata);
      lines.push(
        `  ${when} ${a.actionType} (${a.targetType})${metaStr ? ` - ${metaStr}` : ""}`,
      );
    }
  }
  lines.push("");

  lines.push("RECENT CALLS:");
  if (callLogs.length === 0) {
    lines.push("  (none)");
  } else {
    for (const call of callLogs) {
      const when = call.createdAt.toLocaleDateString();
      const dur = call.duration != null ? `${call.duration}s` : "(no duration)";
      const summaryText = call.transcript?.summary?.trim();
      lines.push(
        `  ${when} - ${call.direction} - ${dur}${summaryText ? ` - ${summaryText.slice(0, 200)}${summaryText.length > 200 ? "…" : ""}` : ""}`,
      );
    }
  }
  lines.push("");

  if (candidateCallContextBlock) {
    lines.push(candidateCallContextBlock);
    lines.push("");
  }

  lines.push("RECENT SMS:");
  if (smsMessages.length === 0) {
    lines.push("  (none)");
  } else {
    for (const m of [...smsMessages].reverse()) {
      const when = m.createdAt.toLocaleDateString();
      lines.push(
        `  ${when} ${m.direction}: ${m.body.slice(0, 180)}${m.body.length > 180 ? "…" : ""}`,
      );
    }
  }

  return lines.join("\n");
}

async function buildRecentCallContextBlock(input: {
  organizationId: string;
  lineDigits: string[];
  where: Prisma.CallLogWhereInput;
  heading: string;
  take?: number;
}): Promise<string> {
  const calls = await prisma.callLog.findMany({
    where: {
      organizationId: input.organizationId,
      AND: [
        callLineWhere(input.lineDigits),
        input.where,
        {
          OR: [
            { transcript: { is: { summary: { not: null } } } },
            { transcript: { is: { transcript: { not: "" } } } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? RECENT_CALL_CONTEXT_TAKE,
    include: { transcript: true },
  });

  return renderRecentCallContextBlock(input.heading, calls);
}

function renderRecentCallContextBlock(
  heading: string,
  calls: CallContextRow[],
): string {
  const callsWithContext = calls.filter((call) => {
    const summary = call.transcript?.summary?.trim() ?? "";
    const transcript = call.transcript?.transcript?.trim() ?? "";
    return summary.length > 0 || transcript.length > 0;
  });
  if (callsWithContext.length === 0) return "";

  const lines: string[] = [`${heading}:`];
  for (const call of callsWithContext) {
    const when = call.createdAt.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const duration = call.duration != null ? `${call.duration}s` : "no duration";
    const status = call.status?.trim() ? ` - ${call.status.trim()}` : "";
    lines.push(`  ${when} - ${call.direction}${status} - ${duration}`);

    const summary = call.transcript?.summary?.trim() ?? "";
    if (summary) {
      lines.push("    AI summary:");
      pushIndentedLines(lines, truncate(summary, CALL_SUMMARY_MAX_CHARS), "      ");
    }

    const transcript = call.transcript?.transcript?.trim() ?? "";
    if (transcript) {
      lines.push("    Transcript excerpt:");
      pushIndentedLines(lines, truncate(transcript, CALL_TRANSCRIPT_MAX_CHARS), "      ");
    }
  }

  return lines.join("\n");
}

function pushIndentedLines(lines: string[], text: string, indent: string) {
  for (const line of text.split("\n")) {
    lines.push(`${indent}${line}`);
  }
}

// --- helpers ---

// Resolve the effective job description for a Neon Job row. Override
// wins when present (recruiter-authored on the job overview), otherwise
// fall back to the inline description column. HTML tags are stripped
// so the AI isn't burning tokens on <p></p> wrappers.
function resolveJobDescription(job: {
  description: string | null;
  override: { description: string | null } | null;
}): string {
  const override = job.override?.description?.trim();
  if (override) return stripHtml(override).trim();
  const inline = job.description?.trim();
  if (inline) return stripHtml(inline).trim();
  return "";
}

type AceCandidateLite = {
  firstName: string;
  lastName: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  skills: string[];
  notes: string | null;
  experience: unknown;
  education: unknown;
};

// Renders Candidate.experience (Json column carrying an AceExp[]
// shape, RF-imported) into the lines used by the WORK HISTORY block.
// Returns [] when the column is null / empty / not an array so the
// caller can render the "(none on file)" fallback.
function renderExperienceBlock(experience: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(experience)) return [];
  type AceExp = {
    designation?: string;
    organization?: string;
    description?: string;
    from_year?: number | string | null;
    to_year?: number | string | null;
  };
  const out: string[] = [];
  for (const raw of experience as AceExp[]) {
    if (!raw || typeof raw !== "object") continue;
    const header =
      [raw.designation, raw.organization].filter((s): s is string => !!s?.trim()).join(" · ") ||
      "(role)";
    const range = [raw.from_year, raw.to_year ?? "present"]
      .filter((x) => x != null && x !== "")
      .join(" – ");
    out.push(`- ${header}${range ? ` (${range})` : ""}`);
    if (raw.description?.trim()) {
      const capped =
        raw.description.length > 400
          ? `${raw.description.slice(0, 400)}…`
          : raw.description;
      out.push(`    ${capped.trim().replace(/\n+/g, " ")}`);
    }
  }
  return out;
}

// Same shape pattern for Candidate.education.
function renderEducationBlock(education: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(education)) return [];
  type AceEdu = {
    school?: string;
    degree?: string;
    description?: string;
    from_year?: number | string | null;
    to_year?: number | string | null;
  };
  const out: string[] = [];
  for (const raw of education as AceEdu[]) {
    if (!raw || typeof raw !== "object") continue;
    const header =
      [raw.degree, raw.school].filter((s): s is string => !!s?.trim()).join(" · ") ||
      "(degree)";
    const range = [raw.from_year, raw.to_year]
      .filter((x) => x != null && x !== "")
      .join(" – ");
    out.push(`- ${header}${range ? ` (${range})` : ""}`);
  }
  return out;
}

// ActivityLog.metadata is a free-form Json column whose shape depends
// on actionType (oldStage/newStage for stage_change, subject for
// email_sent, etc.). Render a compact `k=v` line, capped, so the
// assistant can read the change without us hand-coding every
// actionType. Returns "" when there's nothing meaningful to display.
function renderActivityMetadata(meta: Prisma.JsonValue | null): string {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const entries = Object.entries(meta as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => {
      const value =
        typeof v === "string"
          ? v.length > 80
            ? `${v.slice(0, 80)}…`
            : v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v).slice(0, 80);
      return `${k}=${value}`;
    });
  if (entries.length === 0) return "";
  const joined = entries.join(" ");
  return joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
}

function assembleResumeFromAce(c: AceCandidateLite | null): string {
  if (!c) return "";
  const parts: string[] = [];

  if (c.notes?.trim()) parts.push(`Notes: ${c.notes.trim()}`);
  if (c.skills.length > 0) parts.push(`Skills: ${c.skills.join(", ")}`);

  type AceExp = {
    designation?: string;
    organization?: string;
    description?: string;
    from_year?: number | null;
    to_year?: number | null;
  };
  type AceEdu = {
    school?: string;
    degree?: string;
    description?: string;
    from_year?: number | null;
    to_year?: number | null;
  };

  const experience = Array.isArray(c.experience)
    ? (c.experience as AceExp[])
    : [];
  if (experience.length > 0) {
    parts.push("Experience:");
    for (const e of experience) {
      const header =
        [e.designation, e.organization].filter(Boolean).join(" · ") || "(role)";
      const range = [e.from_year, e.to_year ?? "present"]
        .filter((x) => x != null)
        .join(" – ");
      parts.push(`- ${header}${range ? ` (${range})` : ""}`);
      if (e.description) parts.push(`  ${e.description.trim()}`);
    }
  }

  const education = Array.isArray(c.education) ? (c.education as AceEdu[]) : [];
  if (education.length > 0) {
    parts.push("Education:");
    for (const e of education) {
      const header =
        [e.degree, e.school].filter(Boolean).join(" · ") || "(degree)";
      const range = [e.from_year, e.to_year]
        .filter((x) => x != null)
        .join(" – ");
      parts.push(`- ${header}${range ? ` (${range})` : ""}`);
    }
  }

  return parts.join("\n");
}

// Best-effort first-phone extractor for the Contact.phoneNumbers JSON
// column, which has historically held both `string[]` and
// `{ number: string }[]` payloads. Returns "" when nothing usable lands.
function extractFirstPhone(value: unknown): string {
  if (!value || !Array.isArray(value) || value.length === 0) return "";
  const first = value[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "number" in first) {
    const num = (first as { number?: unknown }).number;
    if (typeof num === "string") return num;
  }
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

// Pulls the most-recent CandidateResume blob for a candidate, runs
// pdf-parse on it, and returns up to `maxChars` of plain text. Silent
// on every failure path (no upload, non-PDF mime, parse error, empty
// text) so the caller can drop the result into the prompt without a
// guard. Tenant-scoped via organizationId.
async function extractResumeTextForCandidate(
  candidateId: string,
  organizationId: string,
  maxChars: number,
): Promise<string> {
  try {
    const resume = await prisma.candidateResume.findFirst({
      where: { candidateId, organizationId, uploadComplete: true },
      orderBy: { uploadedAt: "desc" },
      select: { data: true, blobUrl: true, mimeType: true },
    });
    if (!resume) return "";
    if (!resume.blobUrl && !resume.data) return "";
    if (!resume.mimeType?.toLowerCase().includes("pdf")) return "";
    const mod = (await import("pdf-parse")) as unknown as
      | { default: (buf: Buffer) => Promise<{ text: string }> }
      | ((buf: Buffer) => Promise<{ text: string }>);
    const parse = typeof mod === "function" ? mod : mod.default;
    const out = await parse(await getResumeBytes(resume));
    const text = (out.text ?? "").trim();
    if (!text) return "";
    return truncate(text, maxChars);
  } catch {
    return "";
  }
}

// Job-context Game Plan. Mirrors the client builder's shape so the
// recruiter can ask Claude job-specific questions (sourcing strategy,
// interview prep, comp benchmarking) directly from the job page.
// Tenant-scoped via getCurrentOrg + organizationId in WHERE.
export async function buildJobContext(jobId: string): Promise<string> {
  const org = await getCurrentOrg();
  const session = await getServerSession(authOptions);
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session?.user?.email);

  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: org.id },
    include: {
      client: { select: { id: true, name: true } },
      override: { select: { description: true } },
    },
  });

  if (!job) {
    return "You are an AI recruiting assistant for BreakPoint Talent. The job referenced was not found.";
  }

  const description = resolveJobDescription(job) || "(no description on file)";

  const compRange =
    job.salaryRangeStart && job.salaryRangeEnd
      ? `$${job.salaryRangeStart.toLocaleString()} – $${job.salaryRangeEnd.toLocaleString()}${
          job.salaryFrequency ? ` ${job.salaryFrequency}` : ""
        }`
      : "(unspecified)";

  const placements = await prisma.placement.findMany({
    where: { jobId: job.id, organizationId: org.id },
    select: {
      stage: true,
      candidateId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });

  const stageCounts = new Map<string, number>();
  for (const p of placements) {
    const bucket = canonicalStage(p.stage);
    stageCounts.set(bucket, (stageCounts.get(bucket) ?? 0) + 1);
  }
  const stageLine = Array.from(stageCounts.entries())
    .map(([s, n]) => `${s}: ${n}`)
    .join(", ");
  const candidateIdsInPipeline = Array.from(
    new Set(placements.map((p) => p.candidateId).filter((id): id is string => Boolean(id))),
  );
  const callContextOr: Prisma.CallLogWhereInput[] = [];
  if (job.clientId) callContextOr.push({ clientId: job.clientId });
  if (candidateIdsInPipeline.length > 0) {
    callContextOr.push({ candidateId: { in: candidateIdsInPipeline } });
  }
  const jobCallContextBlock =
    callContextOr.length > 0
      ? await buildRecentCallContextBlock({
          organizationId: org.id,
          lineDigits,
          where: { OR: callContextOr },
          heading:
            "RECENT CALL CONTEXT (client and pipeline candidates - AI summaries and transcript excerpts)",
        })
      : "";

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent. Andrew Kraig is the recruiter; he uses you for sourcing strategy, interview prep, comp benchmarking, and outreach drafting on this specific job.`,
  );
  lines.push("");
  lines.push("=== JOB ===");
  lines.push(`Title: ${job.title}`);
  lines.push(`Client: ${job.client?.name ?? "(unknown client)"}`);
  if (job.locations.length > 0)
    lines.push(`Locations: ${job.locations.join(", ")}`);
  if (job.employmentType) lines.push(`Employment type: ${job.employmentType}`);
  lines.push(`Comp range: ${compRange}`);
  lines.push(`Open: ${job.isOpen ? "yes" : "no"}`);
  if (job.numberOfOpenings) lines.push(`Openings: ${job.numberOfOpenings}`);
  lines.push("");
  lines.push("=== JOB DESCRIPTION ===");
  lines.push(description);
  lines.push("");
  const rawJd = job.rawJobDescription?.trim();
  if (rawJd) {
    lines.push("=== RAW JOB DESCRIPTION (original paste) ===");
    lines.push(rawJd);
    lines.push("");
  }
  const internalNotes = job.internalRecruiterNotes?.trim();
  if (internalNotes) {
    lines.push("=== INTERNAL RECRUITER NOTES ===");
    lines.push(internalNotes);
    lines.push("");
  }
  lines.push("=== PIPELINE SNAPSHOT ===");
  if (placements.length === 0) {
    lines.push("(no candidates in pipeline yet)");
  } else {
    lines.push(`Total in pipeline: ${placements.length}`);
    if (stageLine) lines.push(`Stages: ${stageLine}`);
  }
  lines.push("");
  if (jobCallContextBlock) {
    lines.push(jobCallContextBlock);
    lines.push("");
  }
  lines.push(
    "Use this context to answer Andrew's questions about THIS job specifically. When he asks for sourcing ideas, suggest titles, target companies, and search strategies grounded in the JD above. When he asks for interview prep, surface likely competency areas. When he asks for comp benchmarking, ground it in the comp range plus current market data.",
  );

  return lines.join("\n");
}

// Lightweight display-name resolver for the Claude Panel header pill.
// Cuid-only - callers are expected to pre-resolve any legacy numeric
// URL segment via the per-entity getXByIdentifier helpers before
// invoking this. Returns null when the id doesn't resolve so the pill
// can hide instead of showing a stale fallback.
export async function getEntityDisplayName(
  type: "candidate" | "client" | "job",
  id: string,
): Promise<string | null> {
  const org = await getCurrentOrg();
  if (type === "candidate") {
    const candidate = await prisma.candidate.findFirst({
      where: { id, organizationId: org.id },
      select: { firstName: true, lastName: true },
    });
    if (!candidate) return null;
    return (
      [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
      null
    );
  }
  if (type === "client") {
    const client = await prisma.client.findFirst({
      where: { id, organizationId: org.id },
      select: { name: true },
    });
    return client?.name || null;
  }
  // job
  const job = await prisma.job.findFirst({
    where: { id, organizationId: org.id },
    select: { title: true },
  });
  return job?.title || null;
}
