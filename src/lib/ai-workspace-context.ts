import { getRfCandidatesForOrg, getRfClientsForOrg } from "@/lib/candidates";
import { getRfShapedContactsForOrg } from "@/lib/contacts";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  normalizeClient,
  normalizeJob,
  canonicalStage,
  type RFCandidate,
} from "@/lib/rf-payload-shapes";

// Builds the system prompt for the per-entity AI workspace chat. The spec
// asks to "query Neon for everything available on this client" — but the
// bulk of client/job/candidate identity data lives in RecruiterFlow (Neon
// only stores placements, agreements, benefits, interviews, sms, calls,
// and Ace-native candidates). These builders call both sources so the
// assistant has a full picture.
//
// Each builder is resilient to RF outages: if a remote call throws, the
// section degrades to "(unavailable)" rather than failing the whole
// request.
//
// Resume text note: neither the RF nor Ace schemas store parsed resume
// text — resumes live as binary blobs (Candidate.resumeData / CandidateResume.data).
// The "Resume" block below is assembled from candidate_summary (RF) or
// notes (Ace), plus the structured experience/education/skills arrays.
// This is as close to "full resume text" as the DB can hand us without
// parsing the PDF on every POST.

// Candidate-context Game Plan sends the full resume + full JDs —
// Claude gets the whole story, not a 3k-char summary.
// Client-context loops over every candidate in pipeline though, so
// per-candidate resume stays capped to prevent a 20-candidate client
// from blowing up the prompt. 10k/candidate gives ~3x the old cap and
// still keeps total payload under the 60s function budget for wide
// pipelines.
const CLIENT_LOOP_RESUME_MAX_CHARS = 10_000;

export async function buildClientContext(clientId: string): Promise<string> {
  const rfId = Number(clientId);
  if (!Number.isFinite(rfId)) {
    return "You are an AI recruiting assistant for BreakPoint Talent. No client was selected.";
  }

  const org = await getCurrentOrg();
  const [clients, allJobs, allContacts, allCandidates, placements, agreements, benefits, jobOverrides] = await Promise.all([
    getRfClientsForOrg().catch(() => []),
    (await import("@/lib/candidates")).getRfJobsForOrg().catch(() => []),
    getRfShapedContactsForOrg().catch(() => []),
    getRfCandidatesForOrg().catch(() => []),
    prisma.placement.findMany({ where: { clientRfId: rfId, organizationId: org.id } }),
    prisma.clientAgreement.findMany({
      where: { clientRfId: rfId, uploadComplete: true },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.clientBenefits.findUnique({ where: { clientRfId: rfId } }),
    prisma.jobOverride.findMany({ select: { jobRfId: true, description: true } }),
  ]);

  const rawClient = clients.find((c) => c.id === rfId);
  const client = rawClient ? normalizeClient(rawClient) : null;
  const companyName = client?.name || "(unknown company)";

  const overrideByJob = new Map<number, string | null>();
  for (const o of jobOverrides) overrideByJob.set(o.jobRfId, o.description);

  // Candidate identity lookup — { rfId → full RFCandidate }. Keeps the
  // list record around so the pipeline + resume-assembly code can share
  // one in-memory map instead of scanning `allCandidates` twice.
  const rfCandidateById = new Map<number, RFCandidate>();
  for (const c of allCandidates) rfCandidateById.set(c.id, c);

  const candidateNameByRfId = new Map<number, string>();
  for (const c of allCandidates) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "(unnamed)";
    candidateNameByRfId.set(c.id, name);
  }

  // Candidates-by-job map: jobRfId → array of { name, stage, rfId?, aceId? }.
  // rfId / aceId let the candidate-details section below look up the
  // source record for resume assembly.
  type PipelineEntry = { name: string; stage: string; rfId: number | null; aceId: string | null };
  const candidatesByJob = new Map<number, PipelineEntry[]>();
  for (const c of allCandidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    const name = candidateNameByRfId.get(c.id) ?? "(unnamed)";
    for (const j of jobs) {
      if (typeof j.job_id !== "number") continue;
      if (j.client_company_id !== rfId) continue;
      const list = candidatesByJob.get(j.job_id) ?? [];
      list.push({ name, stage: j.stage_name ?? "(no stage)", rfId: c.id, aceId: null });
      candidatesByJob.set(j.job_id, list);
    }
  }
  // Local placements override RF stage when present (RF lags for stages
  // like offer/hired/rejected that Ace owns locally).
  for (const p of placements) {
    // Workspace is RF-job scoped today. Ace-native Job placements are
    // indexed separately in Phase 4/5; skip them here.
    if (p.jobRfId == null) continue;
    const list = candidatesByJob.get(p.jobRfId) ?? [];
    const name = p.candidateRfId != null
      ? candidateNameByRfId.get(p.candidateRfId) ?? `(candidate #${p.candidateRfId})`
      : `(ace candidate ${p.candidateId?.slice(0, 6) ?? "?"})`;
    const existing = list.find((x) => x.name === name);
    if (existing) existing.stage = p.stage;
    else list.push({ name, stage: p.stage, rfId: p.candidateRfId, aceId: p.candidateId });
    candidatesByJob.set(p.jobRfId, list);
  }

  // Ace-native candidate rows for any placements that point at them via cuid.
  const aceCandidateIds = placements
    .map((p) => p.candidateId)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  const aceCandidates = aceCandidateIds.length > 0
    ? await prisma.candidate.findMany({
        where: { id: { in: aceCandidateIds } },
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
      })
    : [];
  const aceById = new Map(aceCandidates.map((c) => [c.id, c]));

  const clientJobs = allJobs
    .filter((j) => j.company_id === rfId || (Array.isArray(rawClient?.open_jobs) && rawClient.open_jobs.some((oj) => oj.id === j.id)) || (Array.isArray(rawClient?.closed_jobs) && rawClient.closed_jobs.some((cj) => cj.id === j.id)))
    .map((raw) => ({ raw, norm: normalizeJob(raw) }));

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

  const activeJobs = clientJobs.filter((j) => j.raw.is_open !== false);

  // Header block.
  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage the account for ${companyName}. Respond in plain text only. No markdown formatting - no asterisks, no bold, no headers, no dashes for bullets. Write as if composing a text message or email that can be copied and sent directly. Always use proper punctuation including commas between city and state (e.g. Springfield, OH - never Springfield OH). Be concise, commercially sharp, and direct - no filler. Reference the data below automatically. Andrew should never have to paste context into this chat. NEVER include signature lines (Andrew Kraig, BreakPoint Talent, title lines, contact info) anywhere in your response. Andrew's email signature is auto-appended by Ace when a bubble is sent through the Email this button, and adding one here doubles up every email. A short closing line on its own (Thanks, / Best, / Talk soon,) is fine and welcome at the end of email-style responses, but stop there. NEVER use em dashes (the long em-dash character, Unicode U+2014) in any response. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (the regular dash) are fine for compound words.`,
  );
  lines.push("");
  lines.push(
    `COMPANY: ${companyName} | ${client?.website || "(no website)"} | ${client?.industry || "(no industry)"}`,
  );
  lines.push("");

  // Jobs block — now includes the full job description per job.
  lines.push(`JOBS (${activeJobs.length} active):`);
  for (const { raw, norm } of clientJobs) {
    const statusLabel = raw.is_open === false ? "Closed" : norm.statusName || "Active";
    const list = candidatesByJob.get(norm.id) ?? [];
    const c = countByBucket(list);
    const placementCount = placements.filter((p) => p.jobRfId === norm.id && (p.stage === "hired" || p.stage === "pending_start")).length;
    lines.push(`  ${norm.title} - ${norm.location || "(no location)"} - ${statusLabel}`);
    lines.push(
      `  Pipeline: Applied(${c.applied}) Submitted(${c.submitted}) Interview(${c.interviewing}) Kept(${c.kept}) Offer(${c.offer}) Placement(${placementCount})`,
    );
    if (list.length > 0) {
      const names = list.map((x) => `${x.name} (${x.stage})`).join(", ");
      lines.push(`  Candidates: ${names}`);
    }
    const description = resolveJobDescription(raw, overrideByJob);
    if (description) {
      lines.push("  Description:");
      for (const dLine of description.split("\n")) lines.push(`    ${dLine}`);
    }
    lines.push("");
  }

  // Candidate details — one Resume block per unique person across the
  // pipeline. Keeps the AI from needing to stitch metadata to content.
  const uniqueCandidates = collectUniquePipelineCandidates(candidatesByJob);
  if (uniqueCandidates.length > 0) {
    lines.push("CANDIDATE DETAILS:");
    for (const entry of uniqueCandidates) {
      const resume = entry.rfId != null
        ? assembleResumeFromRf(rfCandidateById.get(entry.rfId) ?? null)
        : entry.aceId != null
          ? assembleResumeFromAce(aceById.get(entry.aceId) ?? null)
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
  const clientContacts = allContacts.filter((ct) => ct.client_company_id === rfId);
  for (const ct of clientContacts) {
    const name = [ct.first_name, ct.last_name].filter(Boolean).join(" ") || ct.name || "(unnamed)";
    const email = Array.isArray(ct.email) ? ct.email[0] ?? "" : ct.email ?? "";
    const phoneRaw = Array.isArray(ct.phone_number) && ct.phone_number.length > 0
      ? typeof ct.phone_number[0] === "string"
        ? ct.phone_number[0]
        : ct.phone_number[0]?.number ?? ""
      : "";
    lines.push(`  ${name}, ${ct.current_designation || "(no title)"} - ${email || "(no email)"} | ${phoneRaw || "(no phone)"}`);
  }
  if (clientContacts.length === 0) lines.push("  (none on file)");
  lines.push("");

  // Agreements block.
  lines.push("AGREEMENTS:");
  if (agreements.length === 0) {
    lines.push("  (no uploaded agreement)");
  } else {
    for (const a of agreements) {
      lines.push(`  ${a.filename} - uploaded ${a.uploadedAt.toLocaleDateString()}${a.summary ? ` - summary: ${a.summary.slice(0, 160).trim()}${a.summary.length > 160 ? "…" : ""}` : ""}`);
    }
  }
  const feeFromPlacement = placements.find((p) => p.feePercentage != null);
  const guaranteeFromPlacement = placements.find((p) => p.guaranteePeriodDays != null);
  if (feeFromPlacement?.feePercentage != null || guaranteeFromPlacement?.guaranteePeriodDays != null) {
    const fee = feeFromPlacement?.feePercentage != null ? `${feeFromPlacement.feePercentage}% fee` : null;
    const guarantee = guaranteeFromPlacement?.guaranteePeriodDays != null ? `${guaranteeFromPlacement.guaranteePeriodDays}-day guarantee` : null;
    lines.push(`  Terms (from placements): ${[fee, guarantee].filter(Boolean).join(", ")}`);
  }
  lines.push("");

  // Benefits summary — the authoritative text lives on ClientBenefits.body
  // (either hand-authored or produced by the "Generate Summary" Claude
  // button on the Benefits tab). Embed it verbatim so the assistant
  // answers benefits questions from the stored summary instead of
  // re-parsing the raw carrier PDFs every turn.
  lines.push("BENEFITS SUMMARY:");
  const benefitsBody = benefits?.body?.trim() ?? "";
  if (benefitsBody) {
    for (const bLine of benefitsBody.split("\n")) lines.push(`  ${bLine}`);
  } else {
    lines.push("  (no benefits summary on file — generate one on the Benefits tab)");
  }
  lines.push("");

  // Placements block.
  lines.push("PLACEMENTS:");
  if (placements.length === 0) {
    lines.push("  (no placements on file)");
  } else {
    for (const p of placements) {
      const candidateName = p.candidateRfId != null
        ? candidateNameByRfId.get(p.candidateRfId) ?? `candidate #${p.candidateRfId}`
        : `ace candidate ${p.candidateId?.slice(0, 6) ?? "?"}`;
      const job = clientJobs.find((j) => j.norm.id === p.jobRfId);
      const jobTitle = job?.norm.title ?? `job #${p.jobRfId}`;
      const when = p.startConfirmedAt ?? p.placedAt ?? p.offerReceivedAt;
      const whenStr = when ? ` - ${when.toLocaleDateString()}` : "";
      const amount = p.acceptedSalary ?? p.offerSalary;
      const money = amount != null ? ` - $${amount.toLocaleString()}` : "";
      lines.push(`  ${candidateName} → ${jobTitle} (${p.stage})${whenStr}${money}`);
    }
  }

  return lines.join("\n");
}

export async function buildCandidateContext(candidateId: string): Promise<string> {
  // The URL segment may be a cuid (post-Phase-1 canonical form) or a
  // legacy numeric RF id. Resolve to the Candidate row and query every
  // downstream table by the cuid — candidateRfId is reserved for history
  // only after the cutover.
  const candidate = /^\d+$/.test(candidateId)
    ? await prisma.candidate.findFirst({ where: { rfId: Number(candidateId) } })
    : await prisma.candidate.findUnique({ where: { id: candidateId } });

  const cuid = candidate?.id ?? candidateId;
  const org = await getCurrentOrg();

  const [smsMessages, callLogs, transcripts, placements] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { candidateId: cuid },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.callLog.findMany({
      where: { candidateId: cuid },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { transcript: true },
    }),
    prisma.callTranscript.findMany({
      where: { callLog: { candidateId: cuid } },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    candidate
      ? prisma.placement.findMany({ where: { candidateId: candidate.id, organizationId: org.id } })
      : Promise.resolve([]),
  ]);

  let fullName = "(unknown)";
  let title = "";
  let employer = "";
  let location = "";
  let email = "";
  let phone = "";
  let compTarget = "";
  let skills: string[] = [];
  let resumeText = "";
  let notes = "";

  if (candidate) {
    fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "(unnamed)";
    title = candidate.currentDesignation ?? "";
    employer = candidate.currentOrganization ?? "";
    location = candidate.location ?? "";
    email = candidate.email ?? "";
    phone = candidate.phone ?? "";
    skills = candidate.skills ?? [];
    notes = candidate.notes ?? "";

    // RF-imported candidates carry their original RF payload in `raw`
    // (Phase 1 backfill). Prefer that for the resume assembly because it
    // includes candidate_summary + full experience/education arrays.
    const rawAsRf = candidate.raw as RFCandidate | null;
    if (rawAsRf && typeof rawAsRf === "object") {
      const expSal = (rawAsRf as { expected_salary?: { number?: number | null; currency?: string | null } })
        .expected_salary;
      if (expSal?.number != null) {
        compTarget = `${expSal.currency ?? "USD"} ${expSal.number.toLocaleString()}`;
      }
      resumeText = assembleResumeFromRf(rawAsRf);
    } else {
      // Ace-native candidate — assemble from the structured Neon columns.
      resumeText = assembleResumeFromAce(candidate);
    }

    if (!compTarget) {
      const es = candidate.expectedSalary as { number?: number | null; currency?: string | null } | null;
      if (es?.number != null) {
        compTarget = `${es.currency ?? "USD"} ${es.number.toLocaleString()}`;
      }
    }
  }

  // Applications block — cross-ref job titles + client names from RF and
  // attach the full job description (override first, RF fallback).
  // Phase 2: jobs reads come through the Neon-backed shim
  // (getRfJobsForOrg) instead of live RF. JobOverride lookup scopes to
  // the RF-imported placements only — Ace-native placements carry
  // description on Job.description directly and are fetched separately
  // below if needed.
  const { getRfJobsForOrg } = await import("@/lib/candidates");
  const rfJobRfIds = placements
    .map((p) => p.jobRfId)
    .filter((v): v is number => typeof v === "number");
  const [allJobs, allClients, jobOverrides] = await Promise.all([
    placements.length > 0 ? getRfJobsForOrg().catch(() => []) : Promise.resolve([]),
    placements.length > 0 ? getRfClientsForOrg().catch(() => []) : Promise.resolve([]),
    rfJobRfIds.length > 0
      ? prisma.jobOverride.findMany({
          where: { jobRfId: { in: rfJobRfIds } },
          select: { jobRfId: true, description: true },
        })
      : Promise.resolve([]),
  ]);
  const jobByRfId = new Map(allJobs.map((j) => [j.id, j]));
  const clientNameByRfId = new Map<number, string>();
  for (const c of allClients) clientNameByRfId.set(c.id, normalizeClient(c).name);
  const overrideByJob = new Map<number, string | null>();
  for (const o of jobOverrides) overrideByJob.set(o.jobRfId, o.description);

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage candidate ${fullName}. Respond in plain text only. No markdown formatting - no asterisks, no bold, no headers, no dashes for bullets. Write as if composing a text message or email that can be copied and sent directly. Always use proper punctuation including commas between city and state (e.g. Springfield, OH - never Springfield OH). Be concise and direct. Reference the data below automatically. NEVER include signature lines (Andrew Kraig, BreakPoint Talent, title lines, contact info) anywhere in your response. Andrew's email signature is auto-appended by Ace when a bubble is sent through the Email this button, and adding one here doubles up every email. A short closing line on its own (Thanks, / Best, / Talk soon,) is fine and welcome at the end of email-style responses, but stop there. NEVER use em dashes (the long em-dash character, Unicode U+2014) in any response. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (the regular dash) are fine for compound words.`,
  );
  lines.push("");
  lines.push(`CANDIDATE: ${fullName}${title ? `, ${title}` : ""}${employer ? ` at ${employer}` : ""}`);
  lines.push(`LOCATION: ${location || "(unknown)"}`);
  lines.push(`COMP TARGET: ${compTarget || "(not set)"}`);
  lines.push(`CONTACT: ${email || "(no email)"} | ${phone || "(no phone)"}`);
  if (skills.length > 0) lines.push(`SKILLS: ${skills.join(", ")}`);
  if (notes) lines.push(`NOTES: ${notes.slice(0, 300)}${notes.length > 300 ? "…" : ""}`);
  lines.push("");

  // Full resume content for this candidate. No truncation — Game Plan
  // on a single candidate profile gets the complete resume so Claude
  // can reason over the whole document (multi-role history, detailed
  // bullets, reference sections, etc.).
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
      const jobRaw = p.jobRfId != null ? jobByRfId.get(p.jobRfId) ?? null : null;
      const jobTitle = jobRaw
        ? normalizeJob(jobRaw).title
        : p.jobRfId != null
          ? `job #${p.jobRfId}`
          : `job ${p.jobId ?? "?"}`;
      const clientName = p.clientRfId != null
        ? clientNameByRfId.get(p.clientRfId) ?? `client #${p.clientRfId}`
        : `client ${p.clientId ?? "?"}`;
      lines.push(`  JOB: ${jobTitle} at ${clientName} - Stage: ${p.stage}`);
      const description = jobRaw ? resolveJobDescription(jobRaw, overrideByJob) : "";
      if (description) {
        lines.push(`  JOB DESCRIPTION:`);
        for (const dLine of description.split("\n")) lines.push(`    ${dLine}`);
      } else {
        lines.push(`  JOB DESCRIPTION: (none on file)`);
      }
      lines.push("");
    }
  }

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

  lines.push("RECENT SMS:");
  if (smsMessages.length === 0) {
    lines.push("  (none)");
  } else {
    for (const m of [...smsMessages].reverse()) {
      const when = m.createdAt.toLocaleDateString();
      lines.push(`  ${when} ${m.direction}: ${m.body.slice(0, 180)}${m.body.length > 180 ? "…" : ""}`);
    }
  }

  if (transcripts.length > 0) {
    lines.push("");
    lines.push("RECENT CALL TRANSCRIPTS:");
    for (const t of transcripts) {
      lines.push(`  ${t.createdAt.toLocaleDateString()}: ${t.transcript.slice(0, 500)}${t.transcript.length > 500 ? "…" : ""}`);
    }
  }

  return lines.join("\n");
}

// --- helpers ---

// Resolve the effective job description for a given RF job. Neon's
// JobOverride.description wins when set (recruiter-authored in Ace);
// otherwise fall back to whatever RF imported. Strips HTML tags so the
// AI isn't burning tokens on <p></p> wrappers. Truncates to keep the
// system prompt bounded when RF returns a giant JD.
function resolveJobDescription(
  raw: { description?: unknown; id: number },
  overrideByJob: Map<number, string | null>,
): string {
  const override = overrideByJob.get(raw.id);
  const source =
    override && override.trim().length > 0
      ? override
      : typeof raw.description === "string"
        ? raw.description
        : "";
  if (!source) return "";
  // Full JD — no cap. A 10k-char JD is normal; truncating to 1500
  // dropped the "What You'll Do" bullets on half of them.
  return stripHtml(source).trim();
}

type ExperienceRaw = {
  designation?: string | null;
  organization?: string | null;
  description?: string | null;
  from?: [number | null, number | null] | null;
  to?: [number | null, number | null] | null;
};

type EducationRaw = {
  school?: string | null;
  degree?: string | null;
  description?: string | null;
  from?: [number | null, number | null] | null;
  to?: [number | null, number | null] | null;
};

// Assemble a resume-equivalent text blob from an RF candidate record.
// Pulls candidate_summary, skills, experience[], education[] and flattens
// into labeled blocks. Called by both builders.
function assembleResumeFromRf(c: RFCandidate | null): string {
  if (!c) return "";
  const parts: string[] = [];

  const summary = typeof c.candidate_summary === "string" ? stripHtml(c.candidate_summary).trim() : "";
  if (summary) parts.push(`Summary: ${summary}`);

  const skills = Array.isArray(c.skills) ? (c.skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
  if (skills.length > 0) parts.push(`Skills: ${skills.join(", ")}`);

  const experience = Array.isArray(c.experience) ? (c.experience as ExperienceRaw[]) : [];
  if (experience.length > 0) {
    parts.push("Experience:");
    for (const e of experience) {
      const header = [e.designation, e.organization].filter(Boolean).join(" · ") || "(role)";
      const range = formatMonthYearRange(e.from ?? null, e.to ?? null);
      parts.push(`- ${header}${range ? ` (${range})` : ""}`);
      if (e.description) parts.push(`  ${stripHtml(e.description).trim()}`);
    }
  }

  const education = Array.isArray(c.education) ? (c.education as EducationRaw[]) : [];
  if (education.length > 0) {
    parts.push("Education:");
    for (const e of education) {
      const header = [e.degree, e.school].filter(Boolean).join(" · ") || "(degree)";
      const range = formatMonthYearRange(e.from ?? null, e.to ?? null);
      parts.push(`- ${header}${range ? ` (${range})` : ""}`);
      if (e.description) parts.push(`  ${stripHtml(e.description).trim()}`);
    }
  }

  return parts.join("\n");
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

function assembleResumeFromAce(c: AceCandidateLite | null): string {
  if (!c) return "";
  const parts: string[] = [];

  if (c.notes?.trim()) parts.push(`Notes: ${c.notes.trim()}`);
  if (c.skills.length > 0) parts.push(`Skills: ${c.skills.join(", ")}`);

  type AceExp = { designation?: string; organization?: string; description?: string; from_year?: number | null; to_year?: number | null };
  type AceEdu = { school?: string; degree?: string; description?: string; from_year?: number | null; to_year?: number | null };

  const experience = Array.isArray(c.experience) ? (c.experience as AceExp[]) : [];
  if (experience.length > 0) {
    parts.push("Experience:");
    for (const e of experience) {
      const header = [e.designation, e.organization].filter(Boolean).join(" · ") || "(role)";
      const range = [e.from_year, e.to_year ?? "present"].filter((x) => x != null).join(" – ");
      parts.push(`- ${header}${range ? ` (${range})` : ""}`);
      if (e.description) parts.push(`  ${e.description.trim()}`);
    }
  }

  const education = Array.isArray(c.education) ? (c.education as AceEdu[]) : [];
  if (education.length > 0) {
    parts.push("Education:");
    for (const e of education) {
      const header = [e.degree, e.school].filter(Boolean).join(" · ") || "(degree)";
      const range = [e.from_year, e.to_year].filter((x) => x != null).join(" – ");
      parts.push(`- ${header}${range ? ` (${range})` : ""}`);
    }
  }

  return parts.join("\n");
}

// Dedupe a jobRfId → entries map into a single list of unique candidates,
// preferring the entry with the highest-stage bucket when the same person
// appears on multiple jobs.
function collectUniquePipelineCandidates(
  candidatesByJob: Map<number, Array<{ name: string; stage: string; rfId: number | null; aceId: string | null }>>,
): Array<{ name: string; stage: string; rfId: number | null; aceId: string | null }> {
  const byKey = new Map<string, { name: string; stage: string; rfId: number | null; aceId: string | null }>();
  for (const list of Array.from(candidatesByJob.values())) {
    for (const entry of list) {
      const key = entry.rfId != null ? `rf:${entry.rfId}` : entry.aceId != null ? `ace:${entry.aceId}` : `name:${entry.name}`;
      if (!byKey.has(key)) byKey.set(key, entry);
    }
  }
  return Array.from(byKey.values());
}

function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function formatMonthYearRange(
  from: [number | null, number | null] | null,
  to: [number | null, number | null] | null,
): string {
  const fromStr = formatMonthYearSingle(from);
  const toStr = formatMonthYearSingle(to) || "Present";
  return fromStr ? `${fromStr} – ${toStr}` : "";
}

function formatMonthYearSingle(my: [number | null, number | null] | null): string {
  if (!my || my[1] == null) return "";
  const m = my[0] ? String(my[0]).padStart(2, "0") : "";
  return m ? `${m}/${my[1]}` : String(my[1]);
}

// Job-context Game Plan. Mirrors the client builder's shape so the
// recruiter can ask Claude job-specific questions (sourcing strategy,
// interview prep, comp benchmarking) directly from the job page.
// Tenant-scoped via getCurrentOrg + organizationId in WHERE.
export async function buildJobContext(jobId: string): Promise<string> {
  const org = await getCurrentOrg();

  // Accept either a cuid (canonical) or a numeric legacyRfId (back-
  // compat for older URLs that came through the RF import).
  const job = /^\d+$/.test(jobId)
    ? await prisma.job.findFirst({
        where: { legacyRfId: Number(jobId), organizationId: org.id },
        include: {
          client: { select: { id: true, name: true, legacyRfId: true } },
          override: true,
        },
      })
    : await prisma.job.findFirst({
        where: { id: jobId, organizationId: org.id },
        include: {
          client: { select: { id: true, name: true, legacyRfId: true } },
          override: true,
        },
      });

  if (!job) {
    return "You are an AI recruiting assistant for BreakPoint Talent. The job referenced was not found.";
  }

  const description =
    job.override?.description?.trim() ||
    job.description?.trim() ||
    (typeof (job.raw as Record<string, unknown> | null)?.description === "string"
      ? ((job.raw as Record<string, unknown>).description as string)
      : "") ||
    "(no description on file)";

  const compRange =
    job.salaryRangeStart && job.salaryRangeEnd
      ? `$${job.salaryRangeStart.toLocaleString()} – $${job.salaryRangeEnd.toLocaleString()}${
          job.salaryFrequency ? ` ${job.salaryFrequency}` : ""
        }`
      : "(unspecified)";

  const placements = await prisma.placement.findMany({
    where: { jobId: job.id, organizationId: org.id },
    select: { stage: true, candidateId: true, candidateRfId: true, updatedAt: true },
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

  const lines: string[] = [];
  lines.push(`You are an AI recruiting assistant for BreakPoint Talent. Andrew Kraig is the recruiter; he uses you for sourcing strategy, interview prep, comp benchmarking, and outreach drafting on this specific job.`);
  lines.push("");
  lines.push("=== JOB ===");
  lines.push(`Title: ${job.title}`);
  lines.push(`Client: ${job.client?.name ?? "(unknown client)"}`);
  if (job.locations.length > 0) lines.push(`Locations: ${job.locations.join(", ")}`);
  if (job.employmentType) lines.push(`Employment type: ${job.employmentType}`);
  lines.push(`Comp range: ${compRange}`);
  lines.push(`Open: ${job.isOpen ? "yes" : "no"}`);
  if (job.numberOfOpenings) lines.push(`Openings: ${job.numberOfOpenings}`);
  lines.push("");
  lines.push("=== JOB DESCRIPTION ===");
  lines.push(description);
  lines.push("");
  lines.push("=== PIPELINE SNAPSHOT ===");
  if (placements.length === 0) {
    lines.push("(no candidates in pipeline yet)");
  } else {
    lines.push(`Total in pipeline: ${placements.length}`);
    if (stageLine) lines.push(`Stages: ${stageLine}`);
  }
  lines.push("");
  lines.push("Use this context to answer Andrew's questions about THIS job specifically. When he asks for sourcing ideas, suggest titles, target companies, and search strategies grounded in the JD above. When he asks for interview prep, surface likely competency areas. When he asks for comp benchmarking, ground it in the comp range plus current market data.");

  return lines.join("\n");
}

// Lightweight display-name resolver for the Claude Panel header pill.
// Doesn't run the full build*Context payload — those queries fan out
// to RF + a dozen Neon tables to assemble a system prompt, way more
// work than a name lookup needs. This stays minimal: one indexed
// SELECT per type, scoped to the current org. Returns null when the
// id doesn't resolve so the pill can hide instead of showing a stale
// fallback.
export async function getEntityDisplayName(
  type: "candidate" | "client" | "job",
  id: string,
): Promise<string | null> {
  const org = await getCurrentOrg();
  if (type === "candidate") {
    const candidate = /^\d+$/.test(id)
      ? await prisma.candidate.findFirst({
          where: { rfId: Number(id), organizationId: org.id },
          select: { firstName: true, lastName: true },
        })
      : await prisma.candidate.findFirst({
          where: { id, organizationId: org.id },
          select: { firstName: true, lastName: true },
        });
    if (!candidate) return null;
    return [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || null;
  }
  if (type === "client") {
    const client = /^-?\d+$/.test(id)
      ? await prisma.client.findFirst({
          where: { legacyRfId: Number(id), organizationId: org.id },
          select: { name: true },
        })
      : await prisma.client.findFirst({
          where: { id, organizationId: org.id },
          select: { name: true },
        });
    return client?.name || null;
  }
  // job
  const job = /^\d+$/.test(id)
    ? await prisma.job.findFirst({
        where: { legacyRfId: Number(id), organizationId: org.id },
        select: { title: true },
      })
    : await prisma.job.findFirst({
        where: { id, organizationId: org.id },
        select: { title: true },
      });
  return job?.title || null;
}
