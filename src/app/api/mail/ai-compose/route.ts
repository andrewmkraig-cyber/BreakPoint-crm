import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getGmailThread } from "@/lib/gmail";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { buildPersonalTrainerBlock } from "@/lib/personal-trainer";
import {
  HTML_EMAIL_OUTPUT_FORMAT_RULES,
  convertInlineMarkdownToHtml,
  decodeCommonHtmlEntities,
  markdownishTextToEmailHtml,
} from "@/lib/ai-output-formatting";
import { formatExpectedCompensation } from "@/lib/candidate-compensation";

export const dynamic = "force-dynamic";
// Claude Opus on a moderate context can take 5–15s. 60s leaves room
// for long replies without tripping Vercel's serverless timeout.
export const maxDuration = 60;

// Writes a first-draft email body for the Mail Tab composer. Takes a
// natural-language prompt ("tell Linda her interview moved to Monday
// and apologize") + optional thread id so Claude has the recent
// exchange as background. Returns HTML suitable for dropping straight
// into the composer body.
//
// We don't persist the generated draft — the user edits it freely
// before hitting Send. The only persistence is the eventual outbound
// Gmail message, which goes through the normal /reply path.

const anthropic = new Anthropic();

type AiComposeRequest = {
  prompt: string;
  threadId?: string;
  // Opt-in: when true, ask Claude to also produce a subject line and
  // return it on the response. The composer wires this up to a small
  // checkbox under the Generate button; off by default since most
  // generations are replies where the existing subject is correct.
  includeSubject?: boolean;
  // Ace-side context the composer hands over so Claude can ground
  // generations in the actual candidate / job / client records the
  // recruiter is looking at. All fields optional — the route falls
  // back to context-free generation when nothing's supplied.
  context?: {
    // Candidate cuid (Ace-native) or numeric legacy rfId, stringified.
    candidateRef?: string;
    jobId?: string;
    clientId?: string;
  };
};

type AiComposeResponse =
  | { bodyHtml: string; subject?: string }
  | { error: string };

export async function POST(req: NextRequest): Promise<NextResponse<AiComposeResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Explicit env check so a missing key surfaces as a useful message
  // instead of a generic Anthropic SDK 401. Build-time module load is
  // fine since dynamic = "force-dynamic" defers it to request time —
  // but a misconfigured Vercel env would otherwise produce confusing
  // "Claude couldn't draft that" toasts with no clue why.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[ai-compose] ANTHROPIC_API_KEY missing from runtime env");
    return NextResponse.json(
      { error: "AI compose is not configured (ANTHROPIC_API_KEY missing)." },
      { status: 500 },
    );
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, name: true, profile: { select: { fullName: true, jobTitle: true } } },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  let payload: AiComposeRequest;
  try {
    payload = (await req.json()) as AiComposeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const promptText = (payload.prompt ?? "").trim();
  if (!promptText) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  // Pull the thread so Claude has context when this is a reply. If the
  // thread fetch fails (scope, deleted, etc.) we fall back to a
  // no-context generation rather than bailing.
  let threadSummary = "";
  if (payload.threadId) {
    try {
      const detail = await getGmailThread(user.id, payload.threadId);
      const snippets = detail.messages.slice(-4).map((m) => {
        const date = m.dateIso ? new Date(m.dateIso).toLocaleString() : "";
        const plain = stripHtmlTags(m.bodyHtml).slice(0, 1500);
        return `From: ${m.fromName || m.fromEmail}\nDate: ${date}\nSubject: ${m.subject}\n\n${plain}`;
      });
      threadSummary =
        `Email thread context (most recent 4 messages):\n\n${snippets.join("\n\n---\n\n")}`;
    } catch {
      threadSummary = "";
    }
  }

  const senderName = user.profile?.fullName?.trim() || user.name?.trim() || user.email || "";
  const senderTitle = user.profile?.jobTitle?.trim() || "";
  const includeSubject = Boolean(payload.includeSubject);

  // Personal Trainer rules — appended last so the standing rules
  // (no em dashes, no signoff, voice, etc.) ride after the route's
  // structural prompt logic.
  const org = await getCurrentOrg();
  const trainerBlock = await buildPersonalTrainerBlock(org.id);

  // Ace context block: candidate / job / client profiles the composer
  // is currently tied to. Pulled here so Claude can ground qualifying
  // questions, tone, and merge logic in real records instead of
  // hedging ("I don't have the candidate's profile in front of me").
  const aceContextBlock = await buildAceContextBlock(org.id, payload.context);

  // Two prompt variants:
  //  - body-only (default): same instructions as before; return raw
  //    HTML the composer drops into the editor.
  //  - body + subject (opt-in): ask Claude to emit a fenced JSON
  //    object {"subject": "...", "bodyHtml": "..."} so we can split
  //    the two pieces cleanly without regex-parsing free text.
  const baseSystem = includeSubject
    ? [
        "You are an email-drafting assistant for a recruiter at BreakPoint Talent.",
        "Write a professional, concise email subject line AND body based on the user's instruction.",
        "Return STRICT JSON only - no prose, no preamble, no markdown fences. Shape: {\"subject\":\"...\",\"bodyHtml\":\"...\"}.",
        "Subject: under 80 characters, no quotation marks, no trailing period.",
        "Body: plain HTML with <p> paragraphs. No <html>/<body> wrapper, no inline styles.",
        HTML_EMAIL_OUTPUT_FORMAT_RULES,
        "Do NOT include any greeting line like 'Hi [Name],' UNLESS the user's prompt explicitly addresses a specific person by name; even then, keep it short.",
        senderName ? `The sender is ${senderName}${senderTitle ? `, ${senderTitle}` : ""}.` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "You are an email-drafting assistant for a recruiter at BreakPoint Talent.",
        "Write a professional, concise email body based on the user's instruction.",
        "The recipient and subject are being supplied separately - write ONLY the body text, nothing else.",
        "Do NOT include any greeting line like 'Hi [Name],' UNLESS the user's prompt explicitly addresses a specific person by name; even then, keep it short.",
        "Do NOT include 'Subject:' - the user sets the subject in a separate field.",
        "Return the body formatted as plain HTML with <p> paragraphs. No <html>/<body> wrapper, no inline styles.",
        HTML_EMAIL_OUTPUT_FORMAT_RULES,
        senderName ? `The sender is ${senderName}${senderTitle ? `, ${senderTitle}` : ""}.` : "",
      ]
        .filter(Boolean)
        .join("\n");
  const system = baseSystem + trainerBlock;

  const userMessage = [
    aceContextBlock,
    aceContextBlock ? "\n---\n" : "",
    threadSummary,
    threadSummary ? "\n---\n" : "",
    `Instruction: ${promptText}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      // Subject + a multi-section body can run long; 1024 truncated some
      // generations mid-JSON, which broke parsing and dropped the subject
      // line. 2048 leaves room for the full {subject, bodyHtml} object.
      max_tokens: 2048,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    // Concatenate ALL text blocks rather than grabbing content[0]. When
    // web_search fires, the response shape is:
    //   [server_tool_use, web_search_tool_result, text]
    // The previous content[0]-only path treated the tool_use block as
    // "no content" and 502'd, even though Claude wrote a perfectly
    // good draft sitting two slots later. Joining with blank lines
    // collapses cleanly when there's only one text block.
    const raw = response.content
      .filter(
        (b): b is Extract<(typeof response.content)[number], { type: "text" }> =>
          b.type === "text",
      )
      .map((b) => b.text)
      .join("\n\n")
      .trim();
    if (!raw) {
      // Log the shape so Vercel surfaces what we actually got —
      // helpful when Claude stops on tool_use loop / refusal / max
      // tokens with no text block at all.
      console.error("[ai-compose] no text content from Claude", {
        stop_reason: response.stop_reason,
        block_types: response.content.map((b) => b.type),
      });
      const hint =
        response.stop_reason === "max_tokens"
          ? "Claude hit the response length limit before writing a draft."
          : response.stop_reason === "tool_use"
            ? "Claude got stuck mid-tool-use without writing a draft."
            : "Claude returned no draft body.";
      return NextResponse.json(
        { error: `${hint} Try rephrasing your prompt.` },
        { status: 502 },
      );
    }
    if (includeSubject) {
      // Parse the strict-JSON response. Claude occasionally still
      // wraps in ```json fences despite the system prompt, so strip
      // those before parsing. On any parse failure, fall back to
      // returning the raw text as the body — better degraded UX than
      // a hard error toast.
      const parsed = parseSubjectAndBody(raw);
      if (!parsed) {
        return NextResponse.json({ bodyHtml: toSafeHtml(raw) });
      }
      return NextResponse.json({
        subject: parsed.subject,
        bodyHtml: toSafeHtml(parsed.bodyHtml),
      });
    }
    const bodyHtml = toSafeHtml(raw);
    return NextResponse.json({ bodyHtml });
  } catch (e) {
    // Log full error server-side; surface a short user-facing
    // message. The previous path returned the raw SDK message which
    // could include keys / endpoints we don't want toast-rendering.
    console.error("[ai-compose] Anthropic call failed", e);
    const msg = e instanceof Error ? e.message : "Claude call failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

function parseSubjectAndBody(
  raw: string,
): { subject: string; bodyHtml: string } | null {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` wrappers if Claude added them.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  // Fast path: well-formed JSON.
  try {
    const obj = JSON.parse(s) as { subject?: unknown; bodyHtml?: unknown };
    const subject = typeof obj.subject === "string" ? obj.subject.trim() : "";
    const bodyHtml = typeof obj.bodyHtml === "string" ? obj.bodyHtml : "";
    if (subject && bodyHtml) return { subject, bodyHtml };
  } catch {
    // Fall through to tolerant extraction.
  }

  // Tolerant path. Claude frequently emits bodyHtml with raw (unescaped)
  // newlines, which is invalid JSON and trips JSON.parse - the symptom
  // being the entire {"subject":...,"bodyHtml":...} object landing in the
  // email body with an empty subject. It can also add a preamble or get
  // truncated at max_tokens (no closing brace). Pull both fields out by
  // hand and undo JSON string escaping so the subject still routes to the
  // subject line.
  const subjectMatch = /"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (!subjectMatch) return null;
  const subject = unescapeJsonString(subjectMatch[1]).trim();
  if (!subject) return null;

  let bodyRaw: string | null = null;
  const bodyClosed = /"bodyHtml"\s*:\s*"([\s\S]*)"\s*}\s*$/.exec(s);
  if (bodyClosed) {
    bodyRaw = bodyClosed[1];
  } else {
    // Truncated (hit max_tokens) - grab everything after the opening
    // quote and drop any dangling closing quote / brace.
    const bodyOpen = /"bodyHtml"\s*:\s*"([\s\S]*)$/.exec(s);
    if (bodyOpen) bodyRaw = bodyOpen[1].replace(/"\s*}?\s*$/, "");
  }
  if (bodyRaw == null) return null;
  const bodyHtml = unescapeJsonString(bodyRaw);
  if (!bodyHtml.trim()) return null;
  return { subject, bodyHtml };
}

// Undo JSON string escaping in a single pass so escaped quotes,
// newlines, and unicode in a hand-extracted field render correctly.
function unescapeJsonString(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_m, esc: string) => {
    if (esc[0] === "u") return String.fromCharCode(parseInt(esc.slice(1), 16));
    const map: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      '"': '"',
      "\\": "\\",
      "/": "/",
    };
    return map[esc] ?? esc;
  });
}

// Claude sometimes wraps responses in ```html ... ``` fences or
// preambles like "Here's a draft:"; strip those before returning.
function toSafeHtml(raw: string): string {
  let s = decodeCommonHtmlEntities(raw).trim();
  // Strip markdown code fences.
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");
  // If Claude returned plain text (no <p>), wrap paragraphs ourselves.
  if (!/<\w+[^>]*>/.test(s)) {
    s = markdownishTextToEmailHtml(s);
  }
  // Claude is asked for HTML but routinely leaves inline markdown in the
  // body - **text** for bold headers, [text](url) for links. Those
  // survive as literal characters in the composer and the sent email,
  // so recipients see the raw syntax. Convert just those two constructs
  // here, the single chokepoint every generated body flows through.
  // Scoped to bold + links on purpose: a body with no markdown syntax
  // is returned byte-for-byte unchanged, so plain-prose generations
  // render exactly as they did before.
  return convertInlineMarkdownToHtml(s);
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Resolve Ace records keyed off the composer's current context and
// stringify them into a plain-text block Claude can read. Every read
// is org-scoped; missing IDs short-circuit to an empty block rather
// than risking a cross-tenant leak.
async function buildAceContextBlock(
  organizationId: string,
  ctx?: AiComposeRequest["context"],
): Promise<string> {
  if (!ctx) return "";
  const sections: string[] = [];

  // Candidate — handle both Ace cuid and legacy numeric rfId, matching
  // the resolution pattern in /api/mail/candidate-context.
  if (ctx.candidateRef) {
    const ref = ctx.candidateRef.trim();
    const isNumeric = /^\d+$/.test(ref);
    const candidate = await prisma.candidate.findFirst({
      where: isNumeric
        ? { rfId: Number(ref), organizationId }
        : { id: ref, organizationId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        currentDesignation: true,
        currentOrganization: true,
        location: true,
        skills: true,
        tags: true,
        notes: true,
        expectedSalary: true,
        experience: true,
        linkedinProfile: true,
      },
    });
    if (candidate) {
      const lines: string[] = ["Candidate profile:"];
      const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim();
      if (fullName) lines.push(`- Name: ${fullName}`);
      if (candidate.currentDesignation) lines.push(`- Current title: ${candidate.currentDesignation}`);
      if (candidate.currentOrganization) lines.push(`- Current employer: ${candidate.currentOrganization}`);
      if (candidate.location) lines.push(`- Location: ${candidate.location}`);
      if (candidate.email) lines.push(`- Email: ${candidate.email}`);
      if (candidate.phone) lines.push(`- Phone: ${candidate.phone}`);
      if (candidate.linkedinProfile) lines.push(`- LinkedIn: ${candidate.linkedinProfile}`);
      const expectedComp = formatExpectedSalary(candidate.expectedSalary);
      if (expectedComp) lines.push(`- Expected compensation: ${expectedComp}`);
      if (candidate.skills.length > 0) {
        lines.push(`- Skills: ${candidate.skills.slice(0, 20).join(", ")}`);
      }
      if (candidate.tags.length > 0) {
        lines.push(`- Tags: ${candidate.tags.slice(0, 10).join(", ")}`);
      }
      const experienceSummary = formatExperience(candidate.experience);
      if (experienceSummary) lines.push(`- Experience: ${experienceSummary}`);
      const notes = (candidate.notes ?? "").trim();
      if (notes) lines.push(`- Recruiter notes: ${truncate(notes, 1500)}`);
      sections.push(lines.join("\n"));
    }
  }

  // Job — title, location, description, salary band, employment type.
  if (ctx.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: ctx.jobId, organizationId },
      select: {
        title: true,
        locationCity: true,
        locationState: true,
        locations: true,
        employmentType: true,
        salaryRangeStart: true,
        salaryRangeEnd: true,
        salaryCurrency: true,
        description: true,
        rawJobDescription: true,
        internalRecruiterNotes: true,
        client: { select: { name: true, industry: true } },
      },
    });
    if (job) {
      const lines: string[] = ["Job profile:"];
      if (job.title) lines.push(`- Title: ${job.title}`);
      if (job.client?.name) lines.push(`- Client: ${job.client.name}`);
      const loc = [job.locationCity, job.locationState].filter(Boolean).join(", ");
      const fallbackLoc = loc || job.locations.find((l) => l && l.trim().length > 0) || "";
      if (fallbackLoc) lines.push(`- Location: ${fallbackLoc}`);
      if (job.employmentType) lines.push(`- Employment type: ${job.employmentType}`);
      const salaryBand = formatSalaryBand(
        job.salaryRangeStart,
        job.salaryRangeEnd,
        job.salaryCurrency,
      );
      if (salaryBand) lines.push(`- Salary band: ${salaryBand}`);
      const jobDescription = (job.description || job.rawJobDescription || "").trim();
      if (jobDescription) lines.push(`- Description: ${truncate(jobDescription, 2500)}`);
      const internalNotes = (job.internalRecruiterNotes ?? "").trim();
      if (internalNotes) lines.push(`- Internal recruiter notes: ${truncate(internalNotes, 1000)}`);
      sections.push(lines.join("\n"));
    }
  }

  // Client — only fetch separately when no jobId narrowed it for us;
  // the job join above already surfaces client name + industry.
  if (ctx.clientId && !ctx.jobId) {
    const client = await prisma.client.findFirst({
      where: { id: ctx.clientId, organizationId },
      select: { name: true, industry: true, domain: true, location: true },
    });
    if (client) {
      const lines: string[] = ["Client profile:"];
      if (client.name) lines.push(`- Name: ${client.name}`);
      if (client.industry) lines.push(`- Industry: ${client.industry}`);
      if (client.domain) lines.push(`- Website: ${client.domain}`);
      const clientLocation = formatClientLocation(client.location);
      if (clientLocation) lines.push(`- Location: ${clientLocation}`);
      sections.push(lines.join("\n"));
    }
  }

  if (sections.length === 0) return "";
  return `Ace context for this email (use to ground tone, qualifying questions, and merge logic):\n\n${sections.join("\n\n")}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}

function formatExpectedSalary(value: unknown): string {
  return formatExpectedCompensation(value);
}

function formatSalaryBand(
  start: number | null,
  end: number | null,
  currency: string | null,
): string {
  const cur = currency && currency.trim() ? currency.trim() : "USD";
  if (start != null && end != null) {
    return `${cur} ${start.toLocaleString("en-US")} – ${end.toLocaleString("en-US")}`;
  }
  if (start != null) return `${cur} ${start.toLocaleString("en-US")}+`;
  if (end != null) return `Up to ${cur} ${end.toLocaleString("en-US")}`;
  return "";
}

function formatExperience(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    const entries = value
      .slice(0, 4)
      .map((row) => {
        if (!row || typeof row !== "object") return "";
        const r = row as { title?: unknown; company?: unknown; organization?: unknown; startYear?: unknown; endYear?: unknown };
        const title = typeof r.title === "string" ? r.title.trim() : "";
        const employer =
          (typeof r.company === "string" && r.company.trim()) ||
          (typeof r.organization === "string" && r.organization.trim()) ||
          "";
        const years = [r.startYear, r.endYear]
          .map((y) => (typeof y === "number" || typeof y === "string" ? String(y) : ""))
          .filter(Boolean);
        const range = years.length > 0 ? ` (${years.join(" – ")})` : "";
        const left = [title, employer].filter(Boolean).join(" at ");
        return left ? `${left}${range}` : "";
      })
      .filter(Boolean);
    return entries.join("; ");
  }
  return "";
}

function formatClientLocation(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as { city?: unknown; state?: unknown };
  const city = typeof v.city === "string" ? v.city.trim() : "";
  const state = typeof v.state === "string" ? v.state.trim() : "";
  return [city, state].filter(Boolean).join(", ");
}
