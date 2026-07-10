import type { Prisma } from "@prisma/client";

import { formatExpectedCompensation } from "@/lib/candidate-compensation";
import { prisma } from "@/lib/prisma";
import { formatLocation } from "@/lib/utils";

type RecentWorkspaceMessage = {
  role: string;
  content: string;
};

type AceWideContextInput = {
  organizationId: string;
  entityType: string;
  entityId: string;
  resolvedEntityId: string | null;
  userMessage: string;
  recentMessages: RecentWorkspaceMessage[];
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "have",
  "has",
  "he",
  "her",
  "him",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "she",
  "should",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const ACE_TERMS =
  /\b(ace|crm|system|database|record|records|client|clients|company|companies|account|accounts|job|jobs|role|roles|opening|openings|req|reqs|candidate|candidates|pipeline|placement|placements|interview|interviews|contact|contacts|activity|notes?)\b/i;

const FOLLOWUP_TERMS =
  /\b(my client|the client|this client|that client|the company|this company|that company|talking about|that role|this role|that job|this job|those jobs|those roles|that candidate|this candidate)\b/i;

type ClientMatch = {
  id: string;
  name: string;
  industry: string | null;
  domain: string | null;
  careersPage: string | null;
  linkedinPage: string | null;
  location: Prisma.JsonValue | null;
  overview: string | null;
  candidateBlurb: string | null;
  notes: string | null;
  tags: string[];
  feeAgreementSigned: boolean | null;
  feeAgreementSignedAt: Date | null;
  feePct: number | null;
  updatedAt: Date;
  createdAt: Date;
};

type JobMatch = {
  id: string;
  title: string;
  clientId: string | null;
  isOpen: boolean;
  lifecycle: string | null;
  locations: string[];
  locationCity: string | null;
  locationState: string | null;
  locationZip: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  department: string | null;
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: string | null;
  numberOfOpenings: number | null;
  currentOpening: number | null;
  description: string | null;
  rawJobDescription: string | null;
  internalRecruiterNotes: string | null;
  searchKeywords: string | null;
  updatedAt: Date;
  client: { id: string; name: string; industry: string | null } | null;
  override: { description: string | null } | null;
};

type CandidateMatch = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  skills: string[];
  tags: string[];
  expectedSalary: Prisma.JsonValue | null;
  notes: string | null;
  updatedAt: Date;
};

type ContactMatch = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  emails: string[];
  phoneNumbers: Prisma.JsonValue | null;
  currentDesignation: string | null;
  notes: string | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
  updatedAt: Date;
};

type PlacementRow = {
  id: string;
  stage: string;
  offerReceivedAt: Date | null;
  placedAt: Date | null;
  startConfirmedAt: Date | null;
  offerSalary: number | null;
  acceptedSalary: number | null;
  offerCompensationType: string | null;
  acceptedCompensationType: string | null;
  updatedAt: Date;
  candidateId: string | null;
  jobId: string | null;
  clientId: string | null;
  candidate: { firstName: string; lastName: string | null } | null;
  job: { title: string } | null;
  client: { name: string } | null;
};

type InterviewRow = {
  id: string;
  scheduledAt: Date;
  type: string;
  status: string;
  location: string | null;
  notes: string | null;
  candidateId: string | null;
  jobId: string | null;
  clientId: string | null;
  candidate: { firstName: string; lastName: string | null } | null;
  job: { title: string } | null;
  client: { name: string } | null;
};

type ClientDirectoryRow = ClientMatch & {
  activeJobCount: number;
};

export async function buildAceWideContextBlock(
  input: AceWideContextInput,
): Promise<string> {
  const queryText = buildLookupText(input.userMessage, input.recentMessages);
  const tokens = normalizeQuery(queryText);
  const intent = detectIntent(input.userMessage, queryText, tokens);

  if (!intent.shouldBuild) return "";

  const [clientMatches, jobMatches, candidateMatches] = await Promise.all([
    searchRelevantClients(input.organizationId, tokens),
    searchRelevantJobs(input.organizationId, tokens),
    searchRelevantCandidates(input.organizationId, tokens),
  ]);

  const clientIds = new Set(clientMatches.map((c) => c.id));
  const jobIds = new Set(jobMatches.map((j) => j.id));
  const candidateIds = new Set(candidateMatches.map((c) => c.id));

  const [
    jobsForClients,
    contacts,
    placements,
    interviews,
    benefitsByClient,
    agreementsByClient,
    signalsByClient,
    contactMatches,
    clientDirectory,
    openJobDirectory,
    recentActivity,
  ] = await Promise.all([
    fetchJobsForClients(input.organizationId, Array.from(clientIds)),
    fetchContacts(input.organizationId, tokens, Array.from(clientIds)),
    fetchPlacements(input.organizationId, {
      clientIds: Array.from(clientIds),
      jobIds: Array.from(jobIds),
      candidateIds: Array.from(candidateIds),
    }),
    fetchInterviews(input.organizationId, {
      clientIds: Array.from(clientIds),
      jobIds: Array.from(jobIds),
      candidateIds: Array.from(candidateIds),
    }),
    fetchClientBenefits(input.organizationId, Array.from(clientIds)),
    fetchClientAgreements(input.organizationId, Array.from(clientIds)),
    fetchClientSignals(input.organizationId, Array.from(clientIds)),
    searchRelevantContacts(input.organizationId, tokens),
    intent.includeClientDirectory
      ? fetchClientDirectory(input.organizationId)
      : Promise.resolve([]),
    intent.includeOpenJobDirectory
      ? fetchOpenJobDirectory(input.organizationId)
      : Promise.resolve([]),
    intent.includeRecentActivity
      ? fetchRecentActivity(input.organizationId)
      : Promise.resolve([]),
  ]);

  const dedupedContacts = mergeContacts(contacts, contactMatches);
  const dedupedJobs = mergeJobs(jobMatches, jobsForClients);
  for (const j of dedupedJobs) jobIds.add(j.id);
  for (const c of dedupedContacts) {
    if (c.clientId) clientIds.add(c.clientId);
  }

  const sections: string[] = [];
  if (clientMatches.length > 0) {
    sections.push(
      renderClients(
        clientMatches,
        jobsForClients,
        dedupedContacts,
        placements,
        interviews,
        benefitsByClient,
        agreementsByClient,
        signalsByClient,
      ),
    );
  }
  if (dedupedJobs.length > 0) sections.push(renderJobs(dedupedJobs, placements, interviews));
  if (candidateMatches.length > 0) {
    sections.push(renderCandidates(candidateMatches, placements, interviews));
  }
  if (dedupedContacts.length > 0) sections.push(renderContacts(dedupedContacts));
  if (clientDirectory.length > 0) sections.push(renderClientDirectory(clientDirectory));
  if (openJobDirectory.length > 0) sections.push(renderOpenJobDirectory(openJobDirectory));
  if (recentActivity.length > 0) sections.push(renderRecentActivity(recentActivity));

  if (sections.length === 0 && intent.shouldReportNoMatches) {
    sections.push(
      "No Ace-wide client, job, candidate, contact, placement, or interview records matched the current question plus recent Game Plan conversation.",
    );
  }

  if (sections.length === 0) return "";

  const tokenLine =
    tokens.length > 0
      ? `Search terms considered: ${tokens.slice(0, 16).join(", ")}.`
      : "Search terms considered: broad Ace lookup.";

  return [
    "=== ACE-WIDE CRM CONTEXT ===",
    "This block is generated from the current Game Plan question plus the recent Game Plan conversation. Use it for Ace data outside the current page before saying a client, job, candidate, contact, placement, interview, note, or activity is missing.",
    "Ace is the source of truth for these records. Prefer this block over web_search for internal CRM facts; use web_search only for external facts.",
    `Current Game Plan page: ${input.entityType} ${input.resolvedEntityId ?? input.entityId}.`,
    tokenLine,
    "",
    sections.join("\n\n"),
    "=== END ACE-WIDE CRM CONTEXT ===",
  ].join("\n");
}

function buildLookupText(
  userMessage: string,
  recentMessages: RecentWorkspaceMessage[],
): string {
  const recent = recentMessages
    .slice(-8)
    .map((m) => `${m.role}: ${truncateText(m.content, 1200)}`)
    .join("\n");
  return [userMessage, recent].filter(Boolean).join("\n");
}

function detectIntent(userMessage: string, queryText: string, tokens: string[]) {
  const userLower = userMessage.toLowerCase();
  const combinedLower = queryText.toLowerCase();
  const hasAceTerm = ACE_TERMS.test(userMessage);
  const hasFollowupReference = FOLLOWUP_TERMS.test(userMessage);
  const asksQuestion = /\b(who|what|which|where|when|show|find|search|lookup|list|tell|compare|pull|read|know)\b/i.test(
    userMessage,
  );
  const shouldBuild =
    hasAceTerm ||
    hasFollowupReference ||
    (asksQuestion && ACE_TERMS.test(queryText)) ||
    (tokens.length >= 2 && /\b(client|company|job|role|candidate|pipeline)\b/i.test(combinedLower));

  const includeClientDirectory =
    /\b(all|every|everything|anything|any)\b.*\b(clients?|companies|accounts?)\b/i.test(userLower) ||
    /\b(clients?|companies|accounts?)\b.*\b(all|every|everything|anything|any)\b/i.test(userLower) ||
    /\bmy clients\b/i.test(userLower);

  const includeOpenJobDirectory =
    /\b(all|every|open|active|current)\b.*\b(jobs?|roles?|openings?|reqs?)\b/i.test(userLower) ||
    /\b(jobs?|roles?|openings?|reqs?)\b.*\b(all|every|open|active|current)\b/i.test(userLower);

  const includeRecentActivity =
    /\b(activity|activities|recent|latest|today|yesterday|this week|what happened|notes?)\b/i.test(
      userLower,
    ) && /\b(ace|crm|system|client|job|candidate|pipeline|activity|notes?)\b/i.test(combinedLower);

  return {
    shouldBuild,
    includeClientDirectory,
    includeOpenJobDirectory,
    includeRecentActivity,
    shouldReportNoMatches:
      hasFollowupReference ||
      /\b(ace|crm|system|database|client|clients|company|companies|account|accounts|job|jobs|role|roles|opening|openings|pipeline|placement|placements|interview|interviews|contact|contacts|activity|notes?)\b/i.test(
        userMessage,
      ),
  };
}

function normalizeQuery(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9@.+#&'\-/\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().replace(/^['"]+|['"]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map(singularize);
  return Array.from(new Set(tokens)).slice(0, 36);
}

function singularize(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function scoreToken(value: string | null | undefined, token: string): number {
  if (!value) return 0;
  const hay = value.toLowerCase();
  if (hay === token) return 5;
  if (hay.startsWith(token)) return 4;
  if (hay.includes(` ${token}`) || hay.includes(`-${token}`)) return 3;
  if (hay.includes(token)) return 1;
  return 0;
}

function scoreArrayToken(values: string[] | null | undefined, token: string): number {
  if (!values || values.length === 0) return 0;
  return values.reduce((best, value) => Math.max(best, scoreToken(value, token)), 0);
}

async function searchRelevantClients(
  organizationId: string,
  tokens: string[],
): Promise<ClientMatch[]> {
  if (tokens.length === 0) return [];

  const or: Prisma.ClientWhereInput[] = [];
  for (const token of tokens) {
    or.push(
      { name: { contains: token, mode: "insensitive" } },
      { industry: { contains: token, mode: "insensitive" } },
      { domain: { contains: token, mode: "insensitive" } },
      { overview: { contains: token, mode: "insensitive" } },
      { candidateBlurb: { contains: token, mode: "insensitive" } },
      { notes: { contains: token, mode: "insensitive" } },
      { tags: { has: token } },
    );
  }

  const [textHits, recent] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId, OR: or },
      select: clientSelect,
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.client.findMany({
      where: { organizationId },
      select: clientSelect,
      orderBy: { updatedAt: "desc" },
      take: 250,
    }),
  ]);

  const candidates = dedupeById([...textHits, ...recent]);
  return candidates
    .map((client) => {
      const location = formatClientLocation(client.location);
      let score = 0;
      let hits = 0;
      for (const token of tokens) {
        let per = 0;
        per += 4 * scoreToken(client.name, token);
        per += 2.5 * scoreToken(client.industry, token);
        per += 2 * scoreToken(location, token);
        per += 1.5 * scoreToken(client.domain, token);
        per += 1.2 * scoreArrayToken(client.tags, token);
        per += 0.8 * scoreToken(client.overview, token);
        per += 0.8 * scoreToken(client.candidateBlurb, token);
        per += 0.8 * scoreToken(client.notes, token);
        if (per > 0) hits += 1;
        score += per;
      }
      score += hits * 1.5;
      return { client, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.client.updatedAt.getTime() - a.client.updatedAt.getTime();
    })
    .slice(0, 8)
    .map((row) => row.client);
}

async function searchRelevantJobs(
  organizationId: string,
  tokens: string[],
): Promise<JobMatch[]> {
  if (tokens.length === 0) return [];

  const or: Prisma.JobWhereInput[] = [];
  for (const token of tokens) {
    or.push(
      { title: { contains: token, mode: "insensitive" } },
      { employmentType: { contains: token, mode: "insensitive" } },
      { workplaceType: { contains: token, mode: "insensitive" } },
      { department: { contains: token, mode: "insensitive" } },
      { description: { contains: token, mode: "insensitive" } },
      { rawJobDescription: { contains: token, mode: "insensitive" } },
      { internalRecruiterNotes: { contains: token, mode: "insensitive" } },
      { searchKeywords: { contains: token, mode: "insensitive" } },
      { locations: { has: token } },
      { client: { is: { name: { contains: token, mode: "insensitive" } } } },
    );
  }

  const rows = await prisma.job.findMany({
    where: { organizationId, OR: or },
    select: jobSelect,
    orderBy: [{ isOpen: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });

  return rows
    .map((job) => {
      const location = jobLocation(job);
      const description = resolveJobDescription(job);
      let score = 0;
      let hits = 0;
      for (const token of tokens) {
        let per = 0;
        per += 4 * scoreToken(job.title, token);
        per += 3 * scoreToken(job.client?.name, token);
        per += 2 * scoreToken(location, token);
        per += 1.5 * scoreToken(job.department, token);
        per += 1.2 * scoreToken(job.employmentType, token);
        per += 1.2 * scoreToken(job.workplaceType, token);
        per += 1.5 * scoreToken(job.searchKeywords, token);
        per += 0.7 * scoreToken(description, token);
        per += 0.7 * scoreToken(job.internalRecruiterNotes, token);
        if (per > 0) hits += 1;
        score += per;
      }
      if (job.isOpen) score += 0.5;
      score += hits * 1.5;
      return { job, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.job.updatedAt.getTime() - a.job.updatedAt.getTime();
    })
    .slice(0, 10)
    .map((row) => row.job);
}

async function searchRelevantCandidates(
  organizationId: string,
  tokens: string[],
): Promise<CandidateMatch[]> {
  if (tokens.length === 0) return [];

  const or: Prisma.CandidateWhereInput[] = [];
  for (const token of tokens) {
    or.push(
      { firstName: { contains: token, mode: "insensitive" } },
      { lastName: { contains: token, mode: "insensitive" } },
      { currentDesignation: { contains: token, mode: "insensitive" } },
      { currentOrganization: { contains: token, mode: "insensitive" } },
      { location: { contains: token, mode: "insensitive" } },
      { email: { contains: token, mode: "insensitive" } },
      { notes: { contains: token, mode: "insensitive" } },
      { skills: { has: token } },
      { tags: { has: token } },
    );
  }

  const rows = await prisma.candidate.findMany({
    where: { organizationId, OR: or },
    select: candidateSelect,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return rows
    .map((candidate) => {
      const name = candidateName(candidate);
      let score = 0;
      let hits = 0;
      for (const token of tokens) {
        let per = 0;
        per += 3 * scoreToken(name, token);
        per += 3 * scoreToken(candidate.currentDesignation, token);
        per += 2.5 * scoreToken(candidate.currentOrganization, token);
        per += 2 * scoreToken(candidate.location, token);
        per += 1.5 * scoreArrayToken(candidate.skills, token);
        per += 1 * scoreArrayToken(candidate.tags, token);
        per += 0.8 * scoreToken(candidate.notes, token);
        if (per > 0) hits += 1;
        score += per;
      }
      score += hits * 1.5;
      return { candidate, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.candidate.updatedAt.getTime() - a.candidate.updatedAt.getTime();
    })
    .slice(0, 8)
    .map((row) => row.candidate);
}

async function searchRelevantContacts(
  organizationId: string,
  tokens: string[],
): Promise<ContactMatch[]> {
  if (tokens.length === 0) return [];

  const or: Prisma.ContactWhereInput[] = [];
  for (const token of tokens) {
    or.push(
      { firstName: { contains: token, mode: "insensitive" } },
      { lastName: { contains: token, mode: "insensitive" } },
      { name: { contains: token, mode: "insensitive" } },
      { currentDesignation: { contains: token, mode: "insensitive" } },
      { notes: { contains: token, mode: "insensitive" } },
      { client: { is: { name: { contains: token, mode: "insensitive" } } } },
    );
  }

  const rows = await prisma.contact.findMany({
    where: { organizationId, OR: or },
    select: contactSelect,
    orderBy: { updatedAt: "desc" },
    take: 75,
  });

  return rows
    .map((contact) => {
      const name = contactName(contact);
      let score = 0;
      let hits = 0;
      for (const token of tokens) {
        let per = 0;
        per += 3 * scoreToken(name, token);
        per += 3 * scoreToken(contact.client?.name, token);
        per += 2 * scoreToken(contact.currentDesignation, token);
        per += 0.8 * scoreToken(contact.notes, token);
        if (per > 0) hits += 1;
        score += per;
      }
      score += hits * 1.5;
      return { contact, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.contact.updatedAt.getTime() - a.contact.updatedAt.getTime();
    })
    .slice(0, 10)
    .map((row) => row.contact);
}

async function fetchJobsForClients(
  organizationId: string,
  clientIds: string[],
): Promise<JobMatch[]> {
  if (clientIds.length === 0) return [];
  return prisma.job.findMany({
    where: { organizationId, clientId: { in: clientIds } },
    select: jobSelect,
    orderBy: [{ isOpen: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });
}

async function fetchContacts(
  organizationId: string,
  tokens: string[],
  clientIds: string[],
): Promise<ContactMatch[]> {
  if (clientIds.length === 0 && tokens.length === 0) return [];
  const or: Prisma.ContactWhereInput[] = [];
  if (clientIds.length > 0) or.push({ clientId: { in: clientIds } });
  for (const token of tokens) {
    or.push(
      { firstName: { contains: token, mode: "insensitive" } },
      { lastName: { contains: token, mode: "insensitive" } },
      { name: { contains: token, mode: "insensitive" } },
      { currentDesignation: { contains: token, mode: "insensitive" } },
      { client: { is: { name: { contains: token, mode: "insensitive" } } } },
    );
  }
  return prisma.contact.findMany({
    where: { organizationId, OR: or },
    select: contactSelect,
    orderBy: { updatedAt: "desc" },
    take: 60,
  });
}

async function fetchPlacements(
  organizationId: string,
  ids: { clientIds: string[]; jobIds: string[]; candidateIds: string[] },
): Promise<PlacementRow[]> {
  const or: Prisma.PlacementWhereInput[] = [];
  if (ids.clientIds.length > 0) or.push({ clientId: { in: ids.clientIds } });
  if (ids.jobIds.length > 0) or.push({ jobId: { in: ids.jobIds } });
  if (ids.candidateIds.length > 0) or.push({ candidateId: { in: ids.candidateIds } });
  if (or.length === 0) return [];
  return prisma.placement.findMany({
    where: { organizationId, OR: or },
    select: placementSelect,
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
}

async function fetchInterviews(
  organizationId: string,
  ids: { clientIds: string[]; jobIds: string[]; candidateIds: string[] },
): Promise<InterviewRow[]> {
  const or: Prisma.InterviewWhereInput[] = [];
  if (ids.clientIds.length > 0) or.push({ clientId: { in: ids.clientIds } });
  if (ids.jobIds.length > 0) or.push({ jobId: { in: ids.jobIds } });
  if (ids.candidateIds.length > 0) or.push({ candidateId: { in: ids.candidateIds } });
  if (or.length === 0) return [];
  return prisma.interview.findMany({
    where: { organizationId, OR: or },
    select: interviewSelect,
    orderBy: { scheduledAt: "desc" },
    take: 40,
  });
}

async function fetchClientBenefits(organizationId: string, clientIds: string[]) {
  if (clientIds.length === 0) return new Map<string, string>();
  const rows = await prisma.clientBenefits.findMany({
    where: { organizationId, clientId: { in: clientIds } },
    select: { clientId: true, body: true },
  });
  return new Map(
    rows
      .filter((row): row is { clientId: string; body: string } => Boolean(row.clientId))
      .map((row) => [row.clientId, row.body]),
  );
}

async function fetchClientAgreements(organizationId: string, clientIds: string[]) {
  if (clientIds.length === 0) return new Map<string, Array<{ filename: string; summary: string | null; uploadedAt: Date }>>();
  const rows = await prisma.clientAgreement.findMany({
    where: { organizationId, clientId: { in: clientIds }, uploadComplete: true },
    select: { clientId: true, filename: true, summary: true, uploadedAt: true },
    orderBy: { uploadedAt: "desc" },
    take: 30,
  });
  const out = new Map<string, Array<{ filename: string; summary: string | null; uploadedAt: Date }>>();
  for (const row of rows) {
    if (!row.clientId) continue;
    const list = out.get(row.clientId) ?? [];
    list.push({ filename: row.filename, summary: row.summary, uploadedAt: row.uploadedAt });
    out.set(row.clientId, list);
  }
  return out;
}

async function fetchClientSignals(organizationId: string, clientIds: string[]) {
  if (clientIds.length === 0) return new Map<string, Array<{ companyName: string; jobTitle: string; jobLocation: string | null; status: string; postedAt: Date | null; discoveredAt: Date }>>();
  const rows = await prisma.clientSignal.findMany({
    where: { organizationId, clientId: { in: clientIds } },
    select: {
      clientId: true,
      companyName: true,
      jobTitle: true,
      jobLocation: true,
      status: true,
      postedAt: true,
      discoveredAt: true,
    },
    orderBy: { discoveredAt: "desc" },
    take: 30,
  });
  const out = new Map<string, Array<{ companyName: string; jobTitle: string; jobLocation: string | null; status: string; postedAt: Date | null; discoveredAt: Date }>>();
  for (const row of rows) {
    if (!row.clientId) continue;
    const list = out.get(row.clientId) ?? [];
    list.push({
      companyName: row.companyName,
      jobTitle: row.jobTitle,
      jobLocation: row.jobLocation,
      status: row.status,
      postedAt: row.postedAt,
      discoveredAt: row.discoveredAt,
    });
    out.set(row.clientId, list);
  }
  return out;
}

async function fetchClientDirectory(organizationId: string): Promise<ClientDirectoryRow[]> {
  const [clients, counts] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId },
      select: clientSelect,
      orderBy: { updatedAt: "desc" },
      take: 120,
    }),
    prisma.job.groupBy({
      by: ["clientId"],
      where: { organizationId, clientId: { not: null }, isOpen: true },
      _count: { _all: true },
    }),
  ]);
  const activeByClient = new Map<string, number>();
  for (const count of counts) {
    if (count.clientId) activeByClient.set(count.clientId, count._count._all);
  }
  return clients.map((client) => ({
    ...client,
    activeJobCount: activeByClient.get(client.id) ?? 0,
  }));
}

async function fetchOpenJobDirectory(organizationId: string): Promise<JobMatch[]> {
  return prisma.job.findMany({
    where: { organizationId, isOpen: true },
    select: jobSelect,
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
}

async function fetchRecentActivity(organizationId: string) {
  return prisma.activityLog.findMany({
    where: { organizationId },
    select: {
      actionType: true,
      targetType: true,
      targetId: true,
      timestamp: true,
      metadata: true,
    },
    orderBy: { timestamp: "desc" },
    take: 25,
  });
}

function renderClients(
  clients: ClientMatch[],
  jobs: JobMatch[],
  contacts: ContactMatch[],
  placements: PlacementRow[],
  interviews: InterviewRow[],
  benefitsByClient: Map<string, string>,
  agreementsByClient: Map<string, Array<{ filename: string; summary: string | null; uploadedAt: Date }>>,
  signalsByClient: Map<string, Array<{ companyName: string; jobTitle: string; jobLocation: string | null; status: string; postedAt: Date | null; discoveredAt: Date }>>,
): string {
  const lines = ["RELEVANT CLIENTS:"];
  for (const client of clients) {
    const loc = formatClientLocation(client.location) || "unknown location";
    const fee = client.feePct != null ? `, fee ${client.feePct}%` : "";
    const agreement = client.feeAgreementSigned
      ? `, agreement signed${client.feeAgreementSignedAt ? ` ${formatDate(client.feeAgreementSignedAt)}` : ""}`
      : "";
    lines.push(`- ${client.name}: ${client.industry || "unknown industry"}, ${loc}, ${client.domain || "no website"}${fee}${agreement}`);
    if (client.careersPage) lines.push(`  Careers: ${client.careersPage}`);
    if (client.linkedinPage) lines.push(`  LinkedIn: ${client.linkedinPage}`);
    if (client.tags.length > 0) lines.push(`  Tags: ${client.tags.slice(0, 8).join(", ")}`);
    if (client.overview?.trim()) lines.push(`  Overview: ${truncateText(client.overview, 800)}`);
    if (client.candidateBlurb?.trim()) lines.push(`  Candidate-facing blurb: ${truncateText(client.candidateBlurb, 500)}`);
    if (client.notes?.trim()) lines.push(`  Internal notes: ${truncateText(client.notes, 1200)}`);

    const clientJobs = jobs.filter((job) => job.clientId === client.id).slice(0, 8);
    lines.push(`  Jobs (${clientJobs.filter((job) => job.isOpen).length} active shown):`);
    if (clientJobs.length === 0) {
      lines.push("    (none on file)");
    } else {
      for (const job of clientJobs) lines.push(`    ${renderJobOneLine(job)}`);
    }

    const clientContacts = contacts.filter((contact) => contact.clientId === client.id).slice(0, 6);
    lines.push("  Contacts:");
    if (clientContacts.length === 0) {
      lines.push("    (none on file)");
    } else {
      for (const contact of clientContacts) lines.push(`    ${renderContactOneLine(contact)}`);
    }

    const clientPlacements = placements.filter((p) => p.clientId === client.id).slice(0, 8);
    if (clientPlacements.length > 0) {
      lines.push("  Pipeline/placements:");
      for (const placement of clientPlacements) lines.push(`    ${renderPlacementOneLine(placement)}`);
    }

    const clientInterviews = interviews.filter((iv) => iv.clientId === client.id).slice(0, 8);
    if (clientInterviews.length > 0) {
      lines.push("  Interviews:");
      for (const interview of clientInterviews) lines.push(`    ${renderInterviewOneLine(interview)}`);
    }

    const benefits = benefitsByClient.get(client.id);
    if (benefits?.trim()) lines.push(`  Benefits summary: ${truncateText(benefits, 900)}`);

    const agreements = agreementsByClient.get(client.id) ?? [];
    if (agreements.length > 0) {
      lines.push("  Agreements:");
      for (const agreementRow of agreements.slice(0, 3)) {
        const summary = agreementRow.summary ? ` - ${truncateText(agreementRow.summary, 260)}` : "";
        lines.push(`    ${agreementRow.filename} (${formatDate(agreementRow.uploadedAt)})${summary}`);
      }
    }

    const signals = signalsByClient.get(client.id) ?? [];
    if (signals.length > 0) {
      lines.push("  Client signals:");
      for (const signal of signals.slice(0, 5)) {
        const when = signal.postedAt ?? signal.discoveredAt;
        lines.push(`    ${signal.jobTitle} at ${signal.companyName}${signal.jobLocation ? ` (${signal.jobLocation})` : ""}, ${signal.status}, ${formatDate(when)}`);
      }
    }
  }
  return lines.join("\n");
}

function renderJobs(jobs: JobMatch[], placements: PlacementRow[], interviews: InterviewRow[]): string {
  const lines = ["RELEVANT JOBS:"];
  for (const job of jobs.slice(0, 14)) {
    lines.push(`- ${renderJobOneLine(job)}`);
    if (job.numberOfOpenings != null || job.currentOpening != null) {
      lines.push(
        `  Openings: ${[job.currentOpening != null ? `current ${job.currentOpening}` : null, job.numberOfOpenings != null ? `total ${job.numberOfOpenings}` : null].filter(Boolean).join(", ")}`,
      );
    }
    if (job.searchKeywords?.trim()) lines.push(`  Search keywords: ${truncateText(job.searchKeywords, 300)}`);
    if (job.internalRecruiterNotes?.trim()) lines.push(`  Internal notes: ${truncateText(job.internalRecruiterNotes, 700)}`);
    const description = resolveJobDescription(job);
    if (description) lines.push(`  Description: ${truncateText(description, 1000)}`);

    const jobPlacements = placements.filter((p) => p.jobId === job.id).slice(0, 6);
    if (jobPlacements.length > 0) {
      lines.push("  Pipeline:");
      for (const placement of jobPlacements) lines.push(`    ${renderPlacementOneLine(placement)}`);
    }

    const jobInterviews = interviews.filter((iv) => iv.jobId === job.id).slice(0, 6);
    if (jobInterviews.length > 0) {
      lines.push("  Interviews:");
      for (const interview of jobInterviews) lines.push(`    ${renderInterviewOneLine(interview)}`);
    }
  }
  return lines.join("\n");
}

function renderCandidates(
  candidates: CandidateMatch[],
  placements: PlacementRow[],
  interviews: InterviewRow[],
): string {
  const lines = ["RELEVANT CANDIDATES:"];
  for (const candidate of candidates) {
    const expected = formatExpectedSalary(candidate.expectedSalary);
    const pieces = [
      candidate.currentDesignation || "unknown title",
      candidate.currentOrganization ? `at ${candidate.currentOrganization}` : null,
      candidate.location || null,
      expected ? `target ${expected}` : null,
    ].filter(Boolean);
    lines.push(`- ${candidateName(candidate)}: ${pieces.join(", ")}`);
    if (candidate.email || candidate.phone) lines.push(`  Contact: ${candidate.email || "no email"} | ${candidate.phone || "no phone"}`);
    if (candidate.skills.length > 0) lines.push(`  Skills: ${candidate.skills.slice(0, 18).join(", ")}`);
    if (candidate.tags.length > 0) lines.push(`  Tags: ${candidate.tags.slice(0, 10).join(", ")}`);
    if (candidate.notes?.trim()) lines.push(`  Notes: ${truncateText(candidate.notes, 700)}`);

    const candidatePlacements = placements.filter((p) => p.candidateId === candidate.id).slice(0, 6);
    if (candidatePlacements.length > 0) {
      lines.push("  Applications/placements:");
      for (const placement of candidatePlacements) lines.push(`    ${renderPlacementOneLine(placement)}`);
    }

    const candidateInterviews = interviews.filter((iv) => iv.candidateId === candidate.id).slice(0, 6);
    if (candidateInterviews.length > 0) {
      lines.push("  Interviews:");
      for (const interview of candidateInterviews) lines.push(`    ${renderInterviewOneLine(interview)}`);
    }
  }
  return lines.join("\n");
}

function renderContacts(contacts: ContactMatch[]): string {
  const lines = ["RELEVANT CONTACTS:"];
  for (const contact of contacts.slice(0, 14)) {
    lines.push(`- ${renderContactOneLine(contact)}`);
    if (contact.notes?.trim()) lines.push(`  Notes: ${truncateText(contact.notes, 350)}`);
  }
  return lines.join("\n");
}

function renderClientDirectory(clients: ClientDirectoryRow[]): string {
  const lines = [`CLIENT DIRECTORY SNAPSHOT (${clients.length} most recently updated clients):`];
  for (const client of clients) {
    const loc = formatClientLocation(client.location) || "unknown location";
    const active = `${client.activeJobCount} active job${client.activeJobCount === 1 ? "" : "s"}`;
    lines.push(`- ${client.name}: ${client.industry || "unknown industry"}, ${loc}, ${active}, ${client.domain || "no website"}`);
  }
  return lines.join("\n");
}

function renderOpenJobDirectory(jobs: JobMatch[]): string {
  const lines = [`OPEN JOB DIRECTORY SNAPSHOT (${jobs.length} open jobs):`];
  for (const job of jobs) lines.push(`- ${renderJobOneLine(job)}`);
  return lines.join("\n");
}

function renderRecentActivity(rows: Awaited<ReturnType<typeof fetchRecentActivity>>): string {
  const lines = [`RECENT ACE ACTIVITY (${rows.length} rows):`];
  for (const row of rows) {
    const metadata = renderMetadata(row.metadata);
    lines.push(`- ${formatDate(row.timestamp)} ${row.actionType} on ${row.targetType} ${row.targetId}${metadata ? ` - ${metadata}` : ""}`);
  }
  return lines.join("\n");
}

function renderJobOneLine(job: JobMatch): string {
  const status = job.isOpen ? job.lifecycle || "active" : job.lifecycle || "closed";
  const client = job.client?.name || "unknown client";
  const location = jobLocation(job) || "unknown location";
  const comp = formatSalaryRange(job.salaryRangeStart, job.salaryRangeEnd, job.salaryCurrency, job.salaryFrequency);
  const compPart = comp ? `, ${comp}` : "";
  return `${job.title} at ${client}, ${location}, ${status}${job.employmentType ? `, ${job.employmentType}` : ""}${compPart}`;
}

function renderContactOneLine(contact: ContactMatch): string {
  const title = contact.currentDesignation || "unknown title";
  const client = contact.client?.name || "unknown client";
  const email = contact.emails[0] || "no email";
  const phone = extractFirstPhone(contact.phoneNumbers) || "no phone";
  return `${contactName(contact)}, ${title} at ${client}, ${email} | ${phone}`;
}

function renderPlacementOneLine(placement: PlacementRow): string {
  const candidate = placement.candidate ? candidateName(placement.candidate) : "unknown candidate";
  const job = placement.job?.title || "unknown job";
  const client = placement.client?.name || "unknown client";
  const when = placement.startConfirmedAt ?? placement.placedAt ?? placement.offerReceivedAt ?? placement.updatedAt;
  const amount = placement.acceptedSalary ?? placement.offerSalary;
  const compType = placement.acceptedCompensationType ?? placement.offerCompensationType;
  const comp = amount != null ? `, ${formatCompAmount(amount, compType)}` : "";
  return `${candidate}, ${job} at ${client}, stage ${placement.stage}, ${formatDate(when)}${comp}`;
}

function renderInterviewOneLine(interview: InterviewRow): string {
  const candidate = interview.candidate ? candidateName(interview.candidate) : "unknown candidate";
  const job = interview.job?.title || "unknown job";
  const client = interview.client?.name || "unknown client";
  const loc = interview.location ? `, ${interview.location}` : "";
  const notes = interview.notes ? `, notes: ${truncateText(interview.notes, 220)}` : "";
  return `${candidate}, ${job} at ${client}, ${interview.type}, ${interview.status}, ${interview.scheduledAt.toISOString()}${loc}${notes}`;
}

function candidateName(candidate: { firstName: string | null; lastName: string | null }): string {
  return [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "unnamed candidate";
}

function contactName(contact: { firstName: string | null; lastName: string | null; name: string | null }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.name || "unnamed contact";
}

function jobLocation(job: {
  locationCity: string | null;
  locationState: string | null;
  locationZip: string | null;
  locations: string[];
}): string {
  const cityState = [job.locationCity, job.locationState].filter(Boolean).join(", ");
  const structured = [cityState, job.locationZip].filter(Boolean).join(" ");
  if (structured) return structured;
  return job.locations.filter(Boolean).join("; ");
}

function formatClientLocation(value: Prisma.JsonValue | null): string {
  if (typeof value === "string") return formatLocation(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const raw = value as Record<string, unknown>;
  const loc = formatLocation({
    city: stringFromJson(raw.city),
    state: stringFromJson(raw.state),
    country: stringFromJson(raw.country),
    location: stringFromJson(raw.location),
  });
  const postal = stringFromJson(raw.postal_code) || stringFromJson(raw.postalCode);
  return [loc, postal].filter(Boolean).join(" ");
}

function stringFromJson(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatSalaryRange(
  start: number | null,
  end: number | null,
  currency: string | null,
  frequency: string | null,
): string {
  const prefix = currency && currency !== "USD" ? `${currency} ` : "$";
  const suffix = frequency ? ` ${frequency}` : "";
  if (start != null && end != null) return `${prefix}${start.toLocaleString()}-${prefix}${end.toLocaleString()}${suffix}`;
  if (start != null) return `${prefix}${start.toLocaleString()}+${suffix}`;
  if (end != null) return `up to ${prefix}${end.toLocaleString()}${suffix}`;
  return "";
}

function formatCompAmount(amount: number, type: string | null): string {
  const suffix = type === "hourly" ? "/hr" : "";
  return `$${amount.toLocaleString()}${suffix}`;
}

function formatExpectedSalary(value: Prisma.JsonValue | null): string {
  return formatExpectedCompensation(value);
}

function resolveJobDescription(job: {
  description: string | null;
  rawJobDescription: string | null;
  override: { description: string | null } | null;
}): string {
  const override = job.override?.description?.trim();
  if (override) return stripHtml(override).trim();
  const description = job.description?.trim();
  if (description) return stripHtml(description).trim();
  const raw = job.rawJobDescription?.trim();
  return raw ? stripHtml(raw).trim() : "";
}

function stripHtml(value: string): string {
  return value
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

function truncateText(value: string, max: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, max).trimEnd()}...`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function extractFirstPhone(value: Prisma.JsonValue | null): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const first = value[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "number" in first) {
    const number = (first as { number?: unknown }).number;
    if (typeof number === "string") return number;
  }
  return "";
}

function renderMetadata(meta: Prisma.JsonValue | null): string {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  const pairs = Object.entries(meta as Record<string, unknown>)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => {
      const rendered =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : JSON.stringify(value);
      return `${key}=${truncateText(rendered, 80)}`;
    });
  return truncateText(pairs.join(" "), 240);
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function mergeJobs(primary: JobMatch[], secondary: JobMatch[]): JobMatch[] {
  return dedupeById([...primary, ...secondary]);
}

function mergeContacts(primary: ContactMatch[], secondary: ContactMatch[]): ContactMatch[] {
  return dedupeById([...primary, ...secondary]);
}

const clientSelect = {
  id: true,
  name: true,
  industry: true,
  domain: true,
  careersPage: true,
  linkedinPage: true,
  location: true,
  overview: true,
  candidateBlurb: true,
  notes: true,
  tags: true,
  feeAgreementSigned: true,
  feeAgreementSignedAt: true,
  feePct: true,
  updatedAt: true,
  createdAt: true,
} satisfies Prisma.ClientSelect;

const jobSelect = {
  id: true,
  title: true,
  clientId: true,
  isOpen: true,
  lifecycle: true,
  locations: true,
  locationCity: true,
  locationState: true,
  locationZip: true,
  employmentType: true,
  workplaceType: true,
  department: true,
  salaryRangeStart: true,
  salaryRangeEnd: true,
  salaryCurrency: true,
  salaryFrequency: true,
  numberOfOpenings: true,
  currentOpening: true,
  description: true,
  rawJobDescription: true,
  internalRecruiterNotes: true,
  searchKeywords: true,
  updatedAt: true,
  client: { select: { id: true, name: true, industry: true } },
  override: { select: { description: true } },
} satisfies Prisma.JobSelect;

const candidateSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  currentDesignation: true,
  currentOrganization: true,
  location: true,
  skills: true,
  tags: true,
  expectedSalary: true,
  notes: true,
  updatedAt: true,
} satisfies Prisma.CandidateSelect;

const contactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  name: true,
  emails: true,
  phoneNumbers: true,
  currentDesignation: true,
  notes: true,
  clientId: true,
  client: { select: { id: true, name: true } },
  updatedAt: true,
} satisfies Prisma.ContactSelect;

const placementSelect = {
  id: true,
  stage: true,
  offerReceivedAt: true,
  placedAt: true,
  startConfirmedAt: true,
  offerSalary: true,
  acceptedSalary: true,
  offerCompensationType: true,
  acceptedCompensationType: true,
  updatedAt: true,
  candidateId: true,
  jobId: true,
  clientId: true,
  candidate: { select: { firstName: true, lastName: true } },
  job: { select: { title: true } },
  client: { select: { name: true } },
} satisfies Prisma.PlacementSelect;

const interviewSelect = {
  id: true,
  scheduledAt: true,
  type: true,
  status: true,
  location: true,
  notes: true,
  candidateId: true,
  jobId: true,
  clientId: true,
  candidate: { select: { firstName: true, lastName: true } },
  job: { select: { title: true } },
  client: { select: { name: true } },
} satisfies Prisma.InterviewSelect;
