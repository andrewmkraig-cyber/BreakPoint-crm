import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { MARKDOWN_OUTPUT_FORMAT_RULES } from "@/lib/ai-output-formatting";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getClaude } from "@/lib/claude";
import { formatInterviewWhen } from "@/lib/interview-format";
import { prisma } from "@/lib/prisma";

const INTERVIEW_PREP_MODEL = "claude-haiku-4-5-20251001";

export const maxDuration = 120;

const CONTACT_SELECT = {
  id: true,
  legacyRfId: true,
  firstName: true,
  lastName: true,
  name: true,
  emails: true,
  currentDesignation: true,
  linkedinProfile: true,
} satisfies Prisma.ContactSelect;

const CLIENT_SELECT = {
  id: true,
  legacyRfId: true,
  name: true,
  domain: true,
  linkedinPage: true,
  careersPage: true,
  industry: true,
  companySize: true,
  overview: true,
  candidateBlurb: true,
  contacts: {
    select: CONTACT_SELECT,
    orderBy: [{ name: "asc" }, { firstName: "asc" }],
  },
} satisfies Prisma.ClientSelect;

const JOB_SELECT = {
  id: true,
  legacyRfId: true,
  title: true,
  locations: true,
  employmentType: true,
  workplaceType: true,
  hybridSchedule: true,
  salaryRangeStart: true,
  salaryRangeEnd: true,
  salaryCurrency: true,
  salaryFrequency: true,
  description: true,
  rawJobDescription: true,
  sourceJobUrl: true,
  applyLink: true,
} satisfies Prisma.JobSelect;

const CANDIDATE_SELECT = {
  id: true,
  rfId: true,
  firstName: true,
  lastName: true,
  email: true,
  currentDesignation: true,
  currentOrganization: true,
  location: true,
  skills: true,
  notes: true,
  linkedinProfile: true,
} satisfies Prisma.CandidateSelect;

type PrepContact = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;
type PrepClient = Prisma.ClientGetPayload<{ select: typeof CLIENT_SELECT }>;
type PrepJob = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;
type PrepCandidate = Prisma.CandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>;

type Attendee = {
  id?: string | number | null;
  name?: string | null;
  email?: string | null;
};

type ContactOption = {
  key: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  source: "scheduled" | "client_contact";
  defaultSelected: boolean;
};

type PreparedInterview = {
  id: string;
  label: string;
  scheduledAt: string;
  clientName: string | null;
  jobTitle: string | null;
  contactOptions: ContactOption[];
  defaultContactKeys: string[];
  promptContext: string;
};

type PrepBundle = {
  candidate: {
    id: string;
    name: string;
    firstName: string;
    email: string | null;
  };
  interviews: PreparedInterview[];
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function GET(req: NextRequest) {
  const candidateId = req.nextUrl.searchParams.get("candidateId")?.trim();
  if (!candidateId) {
    return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
  }

  try {
    const bundle = await buildInterviewPrepBundle(candidateId);
    return NextResponse.json({
      candidate: bundle.candidate,
      interviews: bundle.interviews.map((interview) => ({
        id: interview.id,
        label: interview.label,
        scheduledAt: interview.scheduledAt,
        clientName: interview.clientName,
        jobTitle: interview.jobTitle,
        contactOptions: interview.contactOptions,
        defaultContactKeys: interview.defaultContactKeys,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  let candidateId = "";
  let interviewId = "";
  let contactKeys: string[] | undefined;

  try {
    const body = (await req.json()) as {
      candidateId?: unknown;
      interviewId?: unknown;
      contactKeys?: unknown;
    };
    candidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    interviewId = typeof body.interviewId === "string" ? body.interviewId.trim() : "";
    contactKeys = Array.isArray(body.contactKeys)
      ? body.contactKeys.filter((key): key is string => typeof key === "string")
      : undefined;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  if (!candidateId || !interviewId) {
    return NextResponse.json({ error: "Missing candidateId or interviewId" }, { status: 400 });
  }

  try {
    const bundle = await buildInterviewPrepBundle(candidateId);
    const interview = bundle.interviews.find((item) => item.id === interviewId);
    if (!interview) throw new HttpError(404, "Interview not found for this candidate");

    const selectedKeySet =
      contactKeys === undefined ? new Set(interview.defaultContactKeys) : new Set(contactKeys);
    const selectedContacts = interview.contactOptions.filter((contact) => selectedKeySet.has(contact.key));

    const anthropic = getClaude();
    const response = await anthropic.messages.create({
      model: INTERVIEW_PREP_MODEL,
      max_tokens: 2600,
      system: buildSystemPrompt(bundle.candidate.firstName),
      messages: [
        {
          role: "user",
          content:
            "Create a send-ready interview prep email draft for the candidate. " +
            "It must break down the company, the role, who they are interviewing with, and practical tips.\n\n" +
            interview.promptContext +
            "\n\nSELECTED INTERVIEWING TEAM:\n" +
            formatContactContext(selectedContacts),
        },
      ],
    });

    const raw = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
      return NextResponse.json(
        { error: "Claude returned non-JSON response", raw: raw.slice(0, 500) },
        { status: 502 },
      );
    }

    return NextResponse.json({
      subject: stripBannedDashes(parsed.subject.trim()),
      body: stripBannedDashes(stripSignature(parsed.body.trim())),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function buildInterviewPrepBundle(candidateRef: string): Promise<PrepBundle> {
  const org = await getCurrentOrg();
  const candidate = await prisma.candidate.findFirst({
    where: {
      organizationId: org.id,
      ...(/^\d+$/.test(candidateRef) ? { rfId: Number(candidateRef) } : { id: candidateRef }),
    },
    select: CANDIDATE_SELECT,
  });

  if (!candidate) throw new HttpError(404, "Candidate not found");

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidateWhere: Prisma.InterviewWhereInput[] = [{ candidateId: candidate.id }];
  if (candidate.rfId != null) candidateWhere.push({ candidateRfId: candidate.rfId });

  const interviews = await prisma.interview.findMany({
    where: {
      organizationId: org.id,
      status: { notIn: ["cancelled"] },
      scheduledAt: { gte: since },
      OR: candidateWhere,
    },
    orderBy: { scheduledAt: "asc" },
    take: 8,
    select: {
      id: true,
      scheduledAt: true,
      durationMin: true,
      type: true,
      meetLink: true,
      clientAttendees: true,
      location: true,
      jobId: true,
      jobRfId: true,
      clientId: true,
      clientRfId: true,
      job: { select: JOB_SELECT },
      client: { select: CLIENT_SELECT },
    },
  });

  const missingJobRfIds = Array.from(
    new Set(
      interviews
        .filter((interview) => !interview.job && interview.jobRfId != null)
        .map((interview) => interview.jobRfId!),
    ),
  );
  const missingClientRfIds = Array.from(
    new Set(
      interviews
        .filter((interview) => !interview.client && interview.clientRfId != null)
        .map((interview) => interview.clientRfId!),
    ),
  );

  const [legacyJobs, legacyClients] = await Promise.all([
    missingJobRfIds.length > 0
      ? prisma.job.findMany({
          where: { organizationId: org.id, legacyRfId: { in: missingJobRfIds } },
          select: JOB_SELECT,
        })
      : Promise.resolve([]),
    missingClientRfIds.length > 0
      ? prisma.client.findMany({
          where: { organizationId: org.id, legacyRfId: { in: missingClientRfIds } },
          select: CLIENT_SELECT,
        })
      : Promise.resolve([]),
  ]);

  const jobsByRf = new Map(legacyJobs.map((job) => [job.legacyRfId, job]));
  const clientsByRf = new Map(legacyClients.map((client) => [client.legacyRfId, client]));

  const candidateName = fullName(candidate.firstName, candidate.lastName);
  return {
    candidate: {
      id: candidate.id,
      name: candidateName,
      firstName: candidate.firstName || "there",
      email: candidate.email,
    },
    interviews: interviews.map((interview) => {
      const job = interview.job ?? (interview.jobRfId != null ? jobsByRf.get(interview.jobRfId) ?? null : null);
      const client =
        interview.client ?? (interview.clientRfId != null ? clientsByRf.get(interview.clientRfId) ?? null : null);
      const contactOptions = buildContactOptions(parseAttendees(interview.clientAttendees), client?.contacts ?? []);
      const defaultContactKeys = contactOptions
        .filter((contact) => contact.defaultSelected)
        .map((contact) => contact.key);
      const when = formatInterviewWhen(interview.scheduledAt);
      const jobTitle = job?.title ?? null;
      const clientName = client?.name ?? null;
      const label = [when, jobTitle, clientName].filter(Boolean).join(" · ");

      return {
        id: interview.id,
        label,
        scheduledAt: interview.scheduledAt.toISOString(),
        clientName,
        jobTitle,
        contactOptions,
        defaultContactKeys,
        promptContext: buildPromptContext({
          candidate,
          candidateName,
          interview: {
            id: interview.id,
            scheduledAt: interview.scheduledAt,
            durationMin: interview.durationMin,
            type: interview.type,
            meetLink: interview.meetLink,
            location: interview.location,
          },
          client,
          job,
        }),
      };
    }),
  };
}

function buildContactOptions(attendees: Attendee[], contacts: PrepContact[]): ContactOption[] {
  const options: ContactOption[] = [];
  const seenKeys = new Set<string>();

  attendees.forEach((attendee, index) => {
    const matched = findMatchingContact(attendee, contacts);
    if (matched) {
      const option = contactToOption(matched, "scheduled", true);
      if (!seenKeys.has(option.key)) {
        seenKeys.add(option.key);
        options.push(option);
      }
      return;
    }

    const name = attendee.name?.trim() || attendee.email?.trim() || "Interview team member";
    const email = cleanEmail(attendee.email);
    const key = `attendee:${index}:${slugKey(email ?? name)}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    options.push({
      key,
      name,
      title: null,
      email,
      linkedin: null,
      source: "scheduled",
      defaultSelected: true,
    });
  });

  for (const contact of contacts) {
    const option = contactToOption(contact, "client_contact", false);
    if (seenKeys.has(option.key)) continue;
    seenKeys.add(option.key);
    options.push(option);
  }

  return options;
}

function contactToOption(
  contact: PrepContact,
  source: ContactOption["source"],
  defaultSelected: boolean,
): ContactOption {
  return {
    key: `contact:${contact.id}`,
    name: contactName(contact),
    title: contact.currentDesignation?.trim() || null,
    email: cleanEmail(contact.emails[0]),
    linkedin: normalizeUrl(contact.linkedinProfile),
    source,
    defaultSelected,
  };
}

function findMatchingContact(attendee: Attendee, contacts: PrepContact[]): PrepContact | null {
  const attendeeId = attendee.id == null ? "" : String(attendee.id).trim();
  if (attendeeId) {
    const byId = contacts.find(
      (contact) => contact.id === attendeeId || (contact.legacyRfId != null && String(contact.legacyRfId) === attendeeId),
    );
    if (byId) return byId;
  }

  const attendeeEmail = cleanEmail(attendee.email)?.toLowerCase();
  if (attendeeEmail) {
    const byEmail = contacts.find((contact) =>
      contact.emails.some((email) => cleanEmail(email)?.toLowerCase() === attendeeEmail),
    );
    if (byEmail) return byEmail;
  }

  const attendeeName = normalizeName(attendee.name);
  if (attendeeName) {
    const byName = contacts.find((contact) => normalizeName(contactName(contact)) === attendeeName);
    if (byName) return byName;
  }

  return null;
}

function buildPromptContext(input: {
  candidate: PrepCandidate;
  candidateName: string;
  interview: {
    id: string;
    scheduledAt: Date;
    durationMin: number;
    type: string;
    meetLink: string | null;
    location: string | null;
  };
  client: PrepClient | null;
  job: PrepJob | null;
}): string {
  const { candidate, candidateName, interview, client, job } = input;
  const lines: string[] = [];
  lines.push("RECIPIENT / CANDIDATE:");
  lines.push(`Name: ${candidateName}`);
  lines.push(`First name: ${candidate.firstName || "there"}`);
  if (candidate.currentDesignation || candidate.currentOrganization) {
    lines.push(
      `Current background: ${[candidate.currentDesignation, candidate.currentOrganization].filter(Boolean).join(" at ")}`,
    );
  }
  if (candidate.location) lines.push(`Location: ${candidate.location}`);
  if (candidate.skills.length > 0) lines.push(`Known skills: ${candidate.skills.slice(0, 18).join(", ")}`);
  lines.push("");

  lines.push("INTERVIEW DETAILS:");
  lines.push(`When: ${formatInterviewWhen(interview.scheduledAt)}`);
  lines.push(`Duration: ${interview.durationMin} minutes`);
  lines.push(`Format: ${interviewTypeLabel(interview.type)}`);
  if (interview.meetLink) lines.push(`Meeting link: ${interview.meetLink}`);
  if (interview.location) lines.push(`Location/address: ${interview.location}`);
  lines.push("");

  lines.push("COMPANY:");
  if (client) {
    lines.push(`Name: ${client.name}`);
    if (client.candidateBlurb) lines.push(`Candidate-facing blurb: ${truncate(client.candidateBlurb, 900)}`);
    if (client.overview) lines.push(`Overview: ${truncate(client.overview, 1200)}`);
    if (client.domain) lines.push(`Website/domain: ${normalizeUrl(client.domain) ?? client.domain}`);
    if (client.linkedinPage) lines.push(`Company LinkedIn: ${normalizeUrl(client.linkedinPage) ?? client.linkedinPage}`);
    if (client.industry) lines.push(`Industry: ${client.industry}`);
    if (client.companySize) lines.push(`Company size: ${client.companySize}`);
  } else {
    lines.push("(No linked client record found.)");
  }
  lines.push("");

  lines.push("ROLE / OPPORTUNITY:");
  if (job) {
    lines.push(`Title: ${job.title}`);
    if (job.locations.length > 0) lines.push(`Location: ${job.locations.join(", ")}`);
    const work = [job.employmentType, job.workplaceType, job.hybridSchedule].filter(Boolean).join(", ");
    if (work) lines.push(`Work setup: ${work}`);
    const salary = salaryRange(job);
    if (salary) lines.push(`Compensation: ${salary}`);
    if (job.applyLink) lines.push(`Role link: ${job.applyLink}`);
    if (job.sourceJobUrl) lines.push(`Source URL: ${job.sourceJobUrl}`);
    const description = job.description?.trim() || job.rawJobDescription?.trim() || "";
    if (description) lines.push(`Description: ${truncate(description, 3500)}`);
  } else {
    lines.push("(No linked job record found.)");
  }

  return lines.join("\n");
}

function buildSystemPrompt(firstName: string): string {
  return (
    "You write candidate-facing interview prep emails for BreakPoint Talent. " +
    "Output STRICT JSON only, with no markdown fences or extra prose. Shape: " +
    `{ "subject": string, "body": string }. ` +
    "Rules:\n" +
    `- The body must start with "Hi ${firstName || "there"}," followed by a blank line.\n` +
    "- Use these candidate-facing sections in this order: Interview Details, Company Breakdown, Role Breakdown, Interviewing With, Prep Tips.\n" +
    "- Interview Details must include date/time, duration, format, link/address when provided, and any location details.\n" +
    "- Company Breakdown must explain what the company does, relevant industry/size/context, and one candidate-safe reason the opportunity could matter. Use only the facts provided.\n" +
    "- Role Breakdown must summarize the title, setup, location, compensation when provided, and 2-4 responsibilities or fit signals from the job description.\n" +
    "- Interviewing With must name each selected interviewer and include title, email, and LinkedIn when provided. If an interviewer has a LinkedIn URL, include it as a markdown link using that person's name, e.g. [Michael LinkedIn](https://...). If no LinkedIn is provided for someone, do not invent one and do not apologize.\n" +
    "- Prep Tips must include 3-5 practical, tailored bullets based on the company, role, interviewer titles, and candidate background.\n" +
    "- Keep it warm, simple, and sendable. The candidate should feel prepared without reading a novel.\n" +
    "- Never mention internal recruiter notes as internal notes. Use only candidate-safe facts.\n" +
    "- Never invent facts, people, LinkedIn links, addresses, compensation, or meeting links.\n" +
    "- End with a short signoff line only, such as `Thanks,` or `Talk soon,`. Do not include Andrew's name, title, company, phone, or signature lines.\n" +
    "- NEVER use em dashes or en dashes anywhere. Use commas, periods, colons, parentheses, or hyphens instead.\n" +
    "- Never use emojis.\n" +
    MARKDOWN_OUTPUT_FORMAT_RULES +
    "\n- Keep markdown formatting in the body for bullets, bold labels, and links. The downstream renderer converts it to HTML for Gmail."
  );
}

function formatContactContext(contacts: ContactOption[]): string {
  if (contacts.length === 0) return "(No interviewers selected.)";
  return contacts
    .map((contact) => {
      const fields = [
        contact.title ? `Title: ${contact.title}` : null,
        contact.email ? `Email: ${contact.email}` : null,
        contact.linkedin ? `LinkedIn: ${contact.linkedin}` : null,
      ].filter(Boolean);
      return `- ${contact.name}${fields.length > 0 ? ` | ${fields.join(" | ")}` : ""}`;
    })
    .join("\n");
}

function parseAttendees(value: unknown): Attendee[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): Attendee | null => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const id = typeof raw.id === "string" || typeof raw.id === "number" ? raw.id : null;
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const email = typeof raw.email === "string" ? raw.email.trim() : "";
      if (!name && !email && id == null) return null;
      return { id, name, email };
    })
    .filter((item): item is Attendee => item != null);
}

function contactName(contact: PrepContact): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    contact.name?.trim() ||
    contact.emails[0]?.trim() ||
    "Client contact"
  );
}

function fullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || firstName || "Candidate";
}

function cleanEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.|linkedin\.com|[a-z0-9-]+\.[a-z]{2,})(\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function slugKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person";
}

function interviewTypeLabel(type: string): string {
  if (type === "phone_screen") return "Phone screen";
  if (type === "video") return "Video interview";
  if (type === "in_person") return "In-person interview";
  return type.replace(/_/g, " ");
}

function salaryRange(job: PrepJob): string | null {
  const currency = job.salaryCurrency || "USD";
  const frequency = job.salaryFrequency ? ` ${job.salaryFrequency}` : "";
  if (job.salaryRangeStart != null && job.salaryRangeEnd != null) {
    return `${money(job.salaryRangeStart, currency)} - ${money(job.salaryRangeEnd, currency)}${frequency}`;
  }
  if (job.salaryRangeStart != null) return `${money(job.salaryRangeStart, currency)}+${frequency}`;
  if (job.salaryRangeEnd != null) return `Up to ${money(job.salaryRangeEnd, currency)}${frequency}`;
  return null;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trim()}...`;
}

function stripBannedDashes(value: string): string {
  return value.replace(/\s*[–—]\s*/g, ", ");
}

function stripSignature(body: string): string {
  const lines = body.split(/\r?\n/);
  const signatureRe =
    /^(andrew(\s+kraig)?|kraig|breakpoint(\s+talent)?|managing partner.*|founder.*|--+)\s*$/i;
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (!line || signatureRe.test(line)) {
      end -= 1;
      continue;
    }
    break;
  }
  return lines.slice(0, end).join("\n").replace(/\s+$/g, "");
}

function safeParseJson(value: string): { subject?: unknown; body?: unknown } | null {
  const parse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const direct = parse(value);
  if (direct) return direct;
  const match = value.match(/\{[\s\S]*\}/);
  return match ? parse(match[0]) : null;
}

function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}
