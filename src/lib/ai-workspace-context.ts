import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { canonicalStage } from "@/lib/rf-payload-shapes";

// Builds the system prompt for the per-entity AI workspace and Claude
// Panel chats. Every read is Neon-cuid-keyed: RecruiterFlow was retired
// at the Phase 1 cutover, so context is sourced exclusively from the
// Ace-native tables (Candidate, Client, Job, Placement, Contact,
// ClientAgreement, ClientBenefits, JobOverride). Callers are expected
// to pre-resolve any legacy numeric URL segment to a cuid before
// invoking these builders (see getClientByIdentifier / getJobByIdentifier
// / getCandidateByIdentifier in the per-entity lib files).
//
// Resume text note: the schema does not store parsed resume text. The
// "Resume" block below is assembled from the candidate's structured
// columns (notes + experience[] + education[] + skills) so the
// assistant has a near-resume narrative without parsing the PDF on
// every POST.

// Candidate-context Game Plan sends the full resume + full JDs so
// Claude gets the whole story, not a 3k-char summary. Client-context
// loops over every candidate in pipeline though, so per-candidate
// resume stays capped to prevent a 20-candidate client from blowing
// up the prompt. 10k/candidate gives ~3x the old cap and still keeps
// total payload under the 60s function budget for wide pipelines.
const CLIENT_LOOP_RESUME_MAX_CHARS = 10_000;

export async function buildClientContext(clientId: string): Promise<string> {
  const org = await getCurrentOrg();

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

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage the account for ${companyName}. Respond in plain text only. No markdown formatting - no asterisks, no bold, no headers, no dashes for bullets. Write as if composing a text message or email that can be copied and sent directly. Always use proper punctuation including commas between city and state (e.g. Springfield, OH - never Springfield OH). Be concise, commercially sharp, and direct - no filler. Reference the data below automatically. Andrew should never have to paste context into this chat. NEVER include signature lines (Andrew Kraig, BreakPoint Talent, title lines, contact info) anywhere in your response. Andrew's email signature is auto-appended by Ace when a bubble is sent through the Email this button, and adding one here doubles up every email. A short closing line on its own (Thanks, / Best, / Talk soon,) is fine and welcome at the end of email-style responses, but stop there. NEVER use em dashes (the long em-dash character, Unicode U+2014) in any response. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (the regular dash) are fine for compound words.`,
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

  return lines.join("\n");
}

export async function buildCandidateContext(
  candidateId: string,
): Promise<string> {
  const org = await getCurrentOrg();

  const candidate = await prisma.candidate.findFirst({
    where: { id: candidateId, organizationId: org.id },
  });

  if (!candidate) {
    return "You are an AI recruiting assistant for BreakPoint Talent. No candidate was found for the requested record.";
  }

  const [smsMessages, callLogs, transcripts, placements] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { candidateId: candidate.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.callLog.findMany({
      where: { candidateId: candidate.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { transcript: true },
    }),
    prisma.callTranscript.findMany({
      where: { callLog: { candidateId: candidate.id } },
      orderBy: { createdAt: "desc" },
      take: 3,
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
  ]);

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

  let compTarget = "";
  const expectedSalary = candidate.expectedSalary as {
    number?: number | null;
    currency?: string | null;
  } | null;
  if (expectedSalary?.number != null) {
    compTarget = `${expectedSalary.currency ?? "USD"} ${expectedSalary.number.toLocaleString()}`;
  }

  const resumeText = assembleResumeFromAce(candidate);

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage candidate ${fullName}. Respond in plain text only. No markdown formatting - no asterisks, no bold, no headers, no dashes for bullets. Write as if composing a text message or email that can be copied and sent directly. Always use proper punctuation including commas between city and state (e.g. Springfield, OH - never Springfield OH). Be concise and direct. Reference the data below automatically. NEVER include signature lines (Andrew Kraig, BreakPoint Talent, title lines, contact info) anywhere in your response. Andrew's email signature is auto-appended by Ace when a bubble is sent through the Email this button, and adding one here doubles up every email. A short closing line on its own (Thanks, / Best, / Talk soon,) is fine and welcome at the end of email-style responses, but stop there. NEVER use em dashes (the long em-dash character, Unicode U+2014) in any response. Use a colon, comma, parentheses, or a period plus new sentence instead. Hyphens (the regular dash) are fine for compound words.`,
  );
  lines.push("");
  lines.push(
    `CANDIDATE: ${fullName}${title ? `, ${title}` : ""}${employer ? ` at ${employer}` : ""}`,
  );
  lines.push(`LOCATION: ${location || "(unknown)"}`);
  lines.push(`COMP TARGET: ${compTarget || "(not set)"}`);
  lines.push(`CONTACT: ${email || "(no email)"} | ${phone || "(no phone)"}`);
  if (skills.length > 0) lines.push(`SKILLS: ${skills.join(", ")}`);
  if (notes)
    lines.push(
      `NOTES: ${notes.slice(0, 300)}${notes.length > 300 ? "…" : ""}`,
    );
  lines.push("");

  // Full resume content for this candidate. No truncation: Game Plan
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
      lines.push(
        `  ${when} ${m.direction}: ${m.body.slice(0, 180)}${m.body.length > 180 ? "…" : ""}`,
      );
    }
  }

  if (transcripts.length > 0) {
    lines.push("");
    lines.push("RECENT CALL TRANSCRIPTS:");
    for (const t of transcripts) {
      lines.push(
        `  ${t.createdAt.toLocaleDateString()}: ${t.transcript.slice(0, 500)}${t.transcript.length > 500 ? "…" : ""}`,
      );
    }
  }

  return lines.join("\n");
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

// Job-context Game Plan. Mirrors the client builder's shape so the
// recruiter can ask Claude job-specific questions (sourcing strategy,
// interview prep, comp benchmarking) directly from the job page.
// Tenant-scoped via getCurrentOrg + organizationId in WHERE.
export async function buildJobContext(jobId: string): Promise<string> {
  const org = await getCurrentOrg();

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
  lines.push("=== PIPELINE SNAPSHOT ===");
  if (placements.length === 0) {
    lines.push("(no candidates in pipeline yet)");
  } else {
    lines.push(`Total in pipeline: ${placements.length}`);
    if (stageLine) lines.push(`Stages: ${stageLine}`);
  }
  lines.push("");
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
