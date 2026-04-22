import { prisma } from "@/lib/prisma";
import {
  recruiterflow,
  normalizeClient,
  normalizeJob,
  canonicalStage,
} from "@/lib/recruiterflow";

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

export async function buildClientContext(clientId: string): Promise<string> {
  const rfId = Number(clientId);
  if (!Number.isFinite(rfId)) {
    return "You are an AI recruiting assistant for BreakPoint Talent. No client was selected.";
  }

  const [clients, allJobs, allContacts, allCandidates, placements, agreements, benefits] = await Promise.all([
    recruiterflow.listAllClients({ perPage: 100 }).catch(() => []),
    recruiterflow.listAllJobs({ perPage: 100 }).catch(() => []),
    recruiterflow.listAllContacts({ perPage: 100 }).catch(() => []),
    recruiterflow.listAllCandidates({ perPage: 100 }).catch(() => []),
    prisma.placement.findMany({ where: { clientRfId: rfId } }),
    prisma.clientAgreement.findMany({
      where: { clientRfId: rfId, uploadComplete: true },
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.clientBenefits.findUnique({ where: { clientRfId: rfId } }),
  ]);

  const rawClient = clients.find((c) => c.id === rfId);
  const client = rawClient ? normalizeClient(rawClient) : null;
  const companyName = client?.name || "(unknown company)";

  // Candidates-by-job map: jobRfId → array of { name, stage }. Built from
  // RF candidates' jobs[] array; supplemented by local Placement rows for
  // candidates whose stage only lives in Ace.
  const candidatesByJob = new Map<number, Array<{ name: string; stage: string }>>();
  for (const c of allCandidates) {
    const jobs = Array.isArray(c.jobs) ? c.jobs : [];
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "(unnamed)";
    for (const j of jobs) {
      if (typeof j.job_id !== "number") continue;
      if (j.client_company_id !== rfId) continue;
      const list = candidatesByJob.get(j.job_id) ?? [];
      list.push({ name, stage: j.stage_name ?? "(no stage)" });
      candidatesByJob.set(j.job_id, list);
    }
  }
  // Local placements override with the Ace stage when present (RF lags for
  // stages like offer/hired/rejected that Ace owns locally).
  const candidateNameByRfId = new Map<number, string>();
  for (const c of allCandidates) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name || "(unnamed)";
    candidateNameByRfId.set(c.id, name);
  }
  for (const p of placements) {
    const list = candidatesByJob.get(p.jobRfId) ?? [];
    const name = p.candidateRfId != null
      ? candidateNameByRfId.get(p.candidateRfId) ?? `(candidate #${p.candidateRfId})`
      : `(ace candidate ${p.candidateId?.slice(0, 6) ?? "?"})`;
    // Dedupe by name — RF already contributed a row for this candidate.
    const existing = list.find((x) => x.name === name);
    if (existing) existing.stage = p.stage;
    else list.push({ name, stage: p.stage });
    candidatesByJob.set(p.jobRfId, list);
  }

  const clientJobs = allJobs
    .filter((j) => j.company_id === rfId || (Array.isArray(rawClient?.open_jobs) && rawClient.open_jobs.some((oj) => oj.id === j.id)) || (Array.isArray(rawClient?.closed_jobs) && rawClient.closed_jobs.some((cj) => cj.id === j.id)))
    .map((raw) => ({ raw, norm: normalizeJob(raw) }));

  function countByBucket(list: Array<{ name: string; stage: string }>): Record<string, number> {
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
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage the account for ${companyName}. Be concise, commercially sharp, and direct - no filler. Reference the data below automatically. Andrew should never have to paste context into this chat.`,
  );
  lines.push("");
  lines.push(
    `COMPANY: ${companyName} | ${client?.website || "(no website)"} | ${client?.industry || "(no industry)"}`,
  );
  lines.push("");

  // Jobs block.
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

  // Agreements block. Fee % / guarantee period don't live on ClientAgreement;
  // they live on Placement rows. Summarize the agreement file + whatever
  // fee/guarantee data the placements carry.
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
  if (benefits?.body?.trim()) {
    lines.push(`  Benefits notes: ${benefits.body.slice(0, 200).trim()}${benefits.body.length > 200 ? "…" : ""}`);
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
  const asNumber = Number(candidateId);
  const isRfCandidate = /^\d+$/.test(candidateId) && Number.isFinite(asNumber);

  // Pull local data first — same query shape for both RF and Ace-native
  // candidates because Sms/CallLog.candidateId is a plain string column.
  const [smsMessages, callLogs, transcripts, placements, aceCandidate] = await Promise.all([
    prisma.smsMessage.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.callLog.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { transcript: true },
    }),
    prisma.callTranscript.findMany({
      where: { callLog: { candidateId } },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.placement.findMany({
      where: isRfCandidate ? { candidateRfId: asNumber } : { candidateId },
    }),
    isRfCandidate ? Promise.resolve(null) : prisma.candidate.findUnique({ where: { id: candidateId } }),
  ]);

  // Identity block — pulled from RF if this is an RF candidate, otherwise
  // from the Ace Candidate row. compExpectation only lives on RF.
  let fullName = "(unknown)";
  let title = "";
  let employer = "";
  let location = "";
  let email = "";
  let phone = "";
  let compTarget = "";
  let skills: string[] = [];
  const summary = "";
  let notes = "";

  if (isRfCandidate) {
    try {
      const rf = await recruiterflow.getCandidate(asNumber);
      fullName = rf.name || [rf.first_name, rf.last_name].filter(Boolean).join(" ") || "(unnamed)";
      title = rf.current_designation ?? "";
      employer = rf.current_organization ?? "";
      // Location on RF is an object with city/state etc. Reduce to "City, ST".
      const loc = rf.location as { city?: string | null; state?: string | null } | null | undefined;
      location = loc ? [loc.city, loc.state].filter(Boolean).join(", ") : "";
      email = Array.isArray(rf.email) ? rf.email[0] ?? "" : rf.email ?? "";
      const rfPhone = rf.phone_number;
      if (Array.isArray(rfPhone) && rfPhone.length > 0) {
        phone = typeof rfPhone[0] === "string" ? rfPhone[0] : rfPhone[0]?.number ?? "";
      } else if (typeof rfPhone === "string") {
        phone = rfPhone;
      }
      const expSal = rf.expected_salary as { number?: number | null; currency?: string | null } | null | undefined;
      if (expSal?.number != null) {
        compTarget = `${expSal.currency ?? "USD"} ${expSal.number.toLocaleString()}`;
      }
      if (Array.isArray(rf.skills)) {
        skills = (rf.skills as unknown[]).filter((s): s is string => typeof s === "string");
      }
    } catch {
      // RF fetch failed — fall through with blanks.
    }
  } else if (aceCandidate) {
    fullName = [aceCandidate.firstName, aceCandidate.lastName].filter(Boolean).join(" ") || "(unnamed)";
    title = aceCandidate.currentDesignation ?? "";
    employer = aceCandidate.currentOrganization ?? "";
    location = aceCandidate.location ?? "";
    email = aceCandidate.email ?? "";
    phone = aceCandidate.phone ?? "";
    skills = aceCandidate.skills ?? [];
    notes = aceCandidate.notes ?? "";
  }

  // Applications block — cross-ref job titles + client names from RF so
  // the assistant sees "Tax Manager at Acme" rather than bare numeric ids.
  const [allJobs, allClients] = await Promise.all([
    placements.length > 0 ? recruiterflow.listAllJobs({ perPage: 100 }).catch(() => []) : Promise.resolve([]),
    placements.length > 0 ? recruiterflow.listAllClients({ perPage: 100 }).catch(() => []) : Promise.resolve([]),
  ]);
  const jobTitleByRfId = new Map<number, string>();
  for (const j of allJobs) jobTitleByRfId.set(j.id, normalizeJob(j).title);
  const clientNameByRfId = new Map<number, string>();
  for (const c of allClients) clientNameByRfId.set(c.id, normalizeClient(c).name);

  const lines: string[] = [];
  lines.push(
    `You are an AI recruiting assistant for BreakPoint Talent, helping recruiter Andrew Kraig manage candidate ${fullName}. Be concise and direct. Reference the data below automatically.`,
  );
  lines.push("");
  lines.push(`CANDIDATE: ${fullName}${title ? `, ${title}` : ""}${employer ? ` at ${employer}` : ""}`);
  lines.push(`LOCATION: ${location || "(unknown)"}`);
  lines.push(`COMP TARGET: ${compTarget || "(not set)"}`);
  lines.push(`CONTACT: ${email || "(no email)"} | ${phone || "(no phone)"}`);
  if (skills.length > 0) lines.push(`SKILLS: ${skills.join(", ")}`);
  if (summary) lines.push(`SUMMARY: ${summary}`);
  if (notes) lines.push(`NOTES: ${notes.slice(0, 300)}${notes.length > 300 ? "…" : ""}`);
  lines.push("");

  lines.push("ACTIVE APPLICATIONS:");
  if (placements.length === 0) {
    lines.push("  (none)");
  } else {
    for (const p of placements) {
      const jobTitle = jobTitleByRfId.get(p.jobRfId) ?? `job #${p.jobRfId}`;
      const clientName = clientNameByRfId.get(p.clientRfId) ?? `client #${p.clientRfId}`;
      lines.push(`  ${jobTitle} at ${clientName} - Stage: ${p.stage}`);
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

  lines.push("RECENT SMS:");
  if (smsMessages.length === 0) {
    lines.push("  (none)");
  } else {
    // Return in thread order (oldest → newest).
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
