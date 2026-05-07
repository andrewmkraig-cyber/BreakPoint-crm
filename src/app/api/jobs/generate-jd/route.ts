import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL, getClaude, stripMarkdownToPlain } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
// Generate is the heaviest Claude call on this page — match the 60s
// budget the rest of the AI routes use.
export const maxDuration = 60;

// Generates a polished, BreakPoint-formatted job description from the
// raw paste plus the structured Job metadata, and saves it onto
// Job.description (so existing render paths and merge fields pick it up
// automatically). descriptionGeneratedAt is stamped on every save so
// the JD tab can render a "Last generated" timestamp.

type GenerateJdRequest = {
  jobId: string;
  // Echoed back so we don't have to re-hit the DB for fields the
  // recruiter likely just edited via the Overview sidebar. The route
  // re-reads the canonical row to confirm tenancy + pull rawJobDescription.
  jobMeta?: {
    title?: string;
    clientName?: string;
    location?: string;
    compensation?: string;
  };
};

type GenerateJdResponse =
  | { ok: true; description: string; generatedAt: string }
  | { ok: false; error: string };

export async function POST(req: NextRequest): Promise<NextResponse<GenerateJdResponse>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: GenerateJdRequest;
  try {
    body = (await req.json()) as GenerateJdRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const jobId = (body.jobId ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Missing job id." }, { status: 400 });
  }

  const org = await getCurrentOrg();
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: org.id },
    select: {
      id: true,
      legacyRfId: true,
      title: true,
      locations: true,
      salaryRangeStart: true,
      salaryRangeEnd: true,
      salaryCurrency: true,
      salaryFrequency: true,
      employmentType: true,
      rawJobDescription: true,
      client: { select: { name: true } },
    },
  });
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  }

  const raw = (job.rawJobDescription ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Paste a raw job description above before generating." },
      { status: 400 },
    );
  }

  const meta = body.jobMeta ?? {};
  const title = (meta.title ?? job.title ?? "").trim();
  const clientName = (meta.clientName ?? job.client?.name ?? "").trim();
  const location = (meta.location ?? formatLocations(job.locations)).trim();
  const compensation = (meta.compensation ?? formatCompensation(job)).trim();

  let generated: string;
  try {
    generated = await runGenerate({
      raw,
      title,
      clientName,
      location,
      compensation,
      employmentType: job.employmentType ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude call failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const generatedAt = new Date();
  try {
    await prisma.job.update({
      where: { id: job.id },
      data: { description: generated, descriptionGeneratedAt: generatedAt },
    });

    const userId =
      session.user.id ??
      (
        await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true },
        })
      )?.id;
    if (userId) {
      await logActivity({
        organizationId: org.id,
        userId,
        actionType: "job_description_generated",
        targetType: "job",
        targetId: job.id,
        metadata: { jobTitle: job.title, length: generated.length },
      });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Couldn't save generated description." },
      { status: 500 },
    );
  }

  if (job.legacyRfId != null) revalidatePath(`/jobs/${job.legacyRfId}`);
  revalidatePath(`/jobs/${job.id}`);

  return NextResponse.json({
    ok: true,
    description: generated,
    generatedAt: generatedAt.toISOString(),
  });
}

function formatLocations(locations: string[] | null | undefined): string {
  if (!Array.isArray(locations) || locations.length === 0) return "";
  return locations.filter((l) => l && l.trim()).join(", ");
}

function formatCompensation(job: {
  salaryRangeStart: number | null;
  salaryRangeEnd: number | null;
  salaryCurrency: string | null;
  salaryFrequency: string | null;
}): string {
  const { salaryRangeStart: lo, salaryRangeEnd: hi, salaryCurrency, salaryFrequency } = job;
  if (lo == null && hi == null) return "";
  const ccy = (salaryCurrency ?? "USD").toUpperCase();
  const symbol = ccy === "USD" ? "$" : `${ccy} `;
  const fmt = (n: number) => `${symbol}${n.toLocaleString()}`;
  const suffix = salaryFrequency === "hourly" ? " / hr" : " / yr";
  if (lo != null && hi != null && lo !== hi) return `${fmt(lo)} to ${fmt(hi)}${suffix}`;
  const only = lo ?? hi!;
  return `${fmt(only)}${suffix}`;
}

async function runGenerate(params: {
  raw: string;
  title: string;
  clientName: string;
  location: string;
  compensation: string;
  employmentType: string | null;
}): Promise<string> {
  const anthropic = getClaude();

  const metaBlock =
    `Title: ${params.title || "(unspecified)"}\n` +
    `Client: ${params.clientName || "(unspecified)"}\n` +
    `Location: ${params.location || "(unspecified)"}\n` +
    `Compensation: ${params.compensation || "(unspecified)"}\n` +
    (params.employmentType ? `Employment Type: ${params.employmentType}\n` : "");

  const system =
    "You are BreakPoint Talent's recruiter copy assistant. You turn raw, often-unedited job postings into polished, " +
    "candidate-facing job descriptions in the BreakPoint voice — professional, recruiter-friendly, polished, never cheesy. " +
    "Output is plain text only — no markdown, no asterisks, no hash headers, no code fences. " +
    "Section titles sit on their own line, unadorned. Bullets use a leading dash followed by a space ('- '). " +
    "NEVER use em dashes (the long '—' character) or en dashes ('–'). Use a comma, colon, parentheses, or period instead. " +
    "Never include Jobot branding, 'Are you a fit?', legal/EEO boilerplate, recruiter signoffs, cheesy corporate language, or salesy filler. " +
    "Never invent compensation, benefits, or details that aren't in the source.";

  const userPrompt =
    "Rewrite the raw job posting below as a BreakPoint Talent job description. " +
    "Use the structured metadata to fill the Location and Salary header lines. " +
    "If a piece of metadata is unspecified, omit that line entirely (do not write 'unspecified').\n\n" +
    "Output MUST follow this EXACT structure, in this order, with the literal section titles shown:\n\n" +
    "Job Description\n" +
    "Location: [location]\n" +
    "Salary: [salary or compensation range if available]\n" +
    "\n" +
    "[Short pitch header — one punchy candidate-facing reason to apply, single line, no quotes, no exclamation points]\n" +
    "\n" +
    "A bit about us:\n" +
    "Must start with: 'Our client, a [descriptor], is looking to add a [position title] to the growing team in [location].' " +
    "Pick a descriptor that fits the source: examples include 'growing CPA firm', 'well-established accounting firm', " +
    "'fast-growing manufacturing company', 'respected local employer', 'mission-driven organization', " +
    "'national wealth management practice', 'middle-market private-equity-backed company'. " +
    "Use natural, factual language — never cheesy. Follow that opener with 1 to 2 short sentences expanding on the company.\n" +
    "\n" +
    "Why join us?\n" +
    "Bullet list (4 to 7 bullets). Topics to draw from when the source supports them: compensation, benefits, " +
    "flexibility / hybrid / remote, growth opportunity, culture, stability, leadership access, interesting work. " +
    "Skip any topic the source does not support — never fabricate.\n" +
    "\n" +
    "Job Details\n" +
    "\n" +
    "What you'll do:\n" +
    "Bullet list of responsibilities (5 to 10 bullets). Concrete, verb-led, day-to-day tasks pulled from the source.\n" +
    "\n" +
    "What we're looking for:\n" +
    "Bullet list of must-have requirements (5 to 10 bullets). Hard requirements — years, certifications, core skills.\n" +
    "\n" +
    "Nice to have:\n" +
    "Bullet list of optional qualifications. " +
    "OMIT this entire section (header and all) if no preferred / nice-to-have items are present in the source — " +
    "do not write 'None' or 'N/A'.\n\n" +
    "=== Job metadata ===\n" +
    metaBlock +
    "\n=== Raw job posting ===\n" +
    params.raw;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude returned no description. Try again.");
  return stripMarkdownToPlain(text);
}
