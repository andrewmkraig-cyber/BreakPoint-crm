import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { generateJobDescription } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
// Generate is the heaviest Claude call on this page — match the 60s
// budget the rest of the AI routes use.
export const maxDuration = 60;

// Regenerates a polished, BreakPoint-formatted job description and saves
// it onto Job.description (so existing render paths and merge fields pick
// it up automatically). descriptionGeneratedAt is stamped on every save so
// the JD tab can render a "Last generated" timestamp.
//
// This route now delegates to the SAME generator the /jobs/new create flow
// uses (generateJobDescription in lib/claude). That guarantees a job's JD
// comes out in one canonical format - the "## A Bit About Us / ## Why Join
// Us / ## Job Details" structure - whether it was first generated at create
// time or regenerated here. (Previously this route had its own prompt that
// prepended plain "Location:" / "Salary:" header lines, so a regenerate
// produced a subtly different shape than a freshly created job.)

type GenerateJdRequest = {
  jobId: string;
  // Accepted for backward-compat with the JD tab payload; no longer needed
  // since the shared generator reads everything it needs from the source
  // text. Ignored.
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
      rawJobDescription: true,
      description: true,
    },
  });
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  }

  // Source material for the rewrite. Prefer the recruiter's pasted raw JD,
  // but fall back to whatever is already on Job.description so a job that
  // was created through /jobs/new (which saves to description, not
  // rawJobDescription) can still be regenerated. Only error when BOTH are
  // empty.
  const source = (job.rawJobDescription ?? "").trim() || (job.description ?? "").trim();
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "Add a job description above before generating." },
      { status: 400 },
    );
  }

  const title = (body.jobMeta?.title ?? job.title ?? "").trim();

  let generated: string;
  try {
    generated = await generateJobDescription({
      sourceText: source,
      jobTitle: title,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Claude call failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const generatedAt = new Date();
  try {
    // Prisma's @updatedAt directive auto-bumps the column on any
    // update, but we set it explicitly so the /jobs board's
    // "Last Edited" rollup has an unambiguous signal and the
    // ordering matches the generated-at timestamp by the millisecond.
    await prisma.job.update({
      where: { id: job.id },
      data: {
        description: generated,
        descriptionGeneratedAt: generatedAt,
        updatedAt: generatedAt,
      },
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
