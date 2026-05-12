import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
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

  // Normalize to the two values the prompt understands. Legacy rows
  // created before the /jobs/new toggle landed have null here — default
  // them to yearly so existing salary figures don't get mis-described.
  const salaryFrequency: "yearly" | "hourly" =
    job.salaryFrequency === "hourly" ? "hourly" : "yearly";

  let generated: string;
  try {
    generated = await runGenerate({
      raw,
      title,
      clientName,
      location,
      compensation,
      employmentType: job.employmentType ?? null,
      salaryFrequency,
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
  salaryFrequency: "yearly" | "hourly";
}): Promise<string> {
  const anthropic = getClaude();

  // Salary type comes from the explicit Job.salaryFrequency column, not
  // from amount-size heuristics. Past prompts inferred "looks like an
  // hourly rate" from the dollar figure, which broke for low-end annual
  // salaries (e.g. $35,000) and high-end hourly rates ($120/hr). The
  // explicit flag eliminates that guess.
  const salaryTypeLabel = params.salaryFrequency === "hourly" ? "HOURLY" : "SALARY";

  const metaBlock =
    `Title: ${params.title || "(unspecified)"}\n` +
    `Client: ${params.clientName || "(unspecified)"}\n` +
    `Location: ${params.location || "(unspecified)"}\n` +
    `Compensation: ${params.compensation || "(unspecified)"}\n` +
    `Salary Type: ${salaryTypeLabel}\n` +
    (params.employmentType ? `Employment Type: ${params.employmentType}\n` : "");

  const system =
    "You are BreakPoint Talent's recruiter copy assistant. You turn raw, often-unedited job postings into polished, " +
    "candidate-facing job descriptions in the BreakPoint voice — professional, recruiter-friendly, polished, never cheesy. " +
    "Output is GitHub-flavored markdown. Use '## ' for top-level section headings and '### ' for sub-section headings. " +
    "Use markdown bullet lists ('- item'). Do NOT use bold/italic emphasis on body copy, do not add code fences, do not add horizontal rules. " +
    "NEVER use em dashes (the long '—' character) or en dashes ('–'). Use a comma, colon, parentheses, or period instead. " +
    "Never include Jobot branding, 'Are you a fit?', legal/EEO boilerplate, recruiter signoffs, cheesy corporate language, or salesy filler. " +
    "Never invent compensation, benefits, or details that aren't in the source.";

  const userPrompt =
    "Rewrite the raw job posting below as a BreakPoint Talent job description, as GitHub-flavored markdown. " +
    "Use the structured metadata to fill the Location and Salary header lines. " +
    "If a piece of metadata is unspecified, omit that line entirely (do not write 'unspecified').\n\n" +
    "Output MUST follow this EXACT structure, in this order, with the literal section titles shown. " +
    "Top-level sections use '## ' (H2). Sub-sections under Job Details use '### ' (H3). The Location/Salary lines and the pitch header are plain paragraphs — no heading markers.\n\n" +
    "Salary Type rules — use the 'Salary Type' field in the metadata block below. " +
    "If Salary Type is HOURLY: write the Salary line as e.g. 'Salary: $25.00 to $30.00 per hour' and write any compensation bullets under 'Why Join Us' in hourly terms (e.g. 'Competitive hourly pay starting at $25.00 per hour'). " +
    "If Salary Type is SALARY: write the Salary line as e.g. 'Salary: $80,000 to $120,000 per year' and write compensation bullets in annual terms (e.g. 'Competitive salary starting at $80,000'). " +
    "Never call an hourly number a 'salary' or an annual figure 'per hour'. Do not infer hourly vs. annual from the dollar amount — trust the Salary Type field.\n\n" +
    "Location: [location]\n" +
    "Salary: [salary or compensation range if available, formatted per the Salary Type rule]\n" +
    "\n" +
    "[Short pitch header — one punchy candidate-facing reason to apply, single line, no quotes, no exclamation points]\n" +
    "\n" +
    "## A Bit About Us\n" +
    "Must start with: 'Our client, a [descriptor], is looking to add a [position title] to the growing team in [location].' " +
    "Pick a descriptor that fits the source: examples include 'growing CPA firm', 'well-established accounting firm', " +
    "'fast-growing manufacturing company', 'respected local employer', 'mission-driven organization', " +
    "'national wealth management practice', 'middle-market private-equity-backed company'. " +
    "Use natural, factual language — never cheesy. Follow that opener with 1 to 2 short sentences expanding on the company.\n" +
    "\n" +
    "## Why Join Us\n" +
    "Bullet list (4 to 7 bullets). Topics to draw from when the source supports them: compensation, benefits, " +
    "flexibility / hybrid / remote, growth opportunity, culture, stability, leadership access, interesting work. " +
    "Skip any topic the source does not support — never fabricate.\n" +
    "\n" +
    "## Job Details\n" +
    "(No body copy directly under this header — only the sub-sections below.)\n" +
    "\n" +
    "### Key Responsibilities and Duties\n" +
    "Bullet list of responsibilities (5 to 10 bullets). Concrete, verb-led, day-to-day tasks pulled from the source.\n" +
    "\n" +
    "### You Should Have Most of the Following\n" +
    "Bullet list of must-have requirements (5 to 10 bullets). Hard requirements — years, certifications, core skills.\n" +
    "\n" +
    "### Nice to Have\n" +
    "Bullet list of optional qualifications. " +
    "OMIT this entire sub-section (heading and all) if no preferred / nice-to-have items are present in the source — " +
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
  // JD is stored as markdown so the JD preview can render H2/H3 hierarchy.
  // Merge-field resolvers ([Job Description] / {{job.description}}) strip
  // the markdown back to plain text so emails don't paste literal `##`.
  return text;
}
