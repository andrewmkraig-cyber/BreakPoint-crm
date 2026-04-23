"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { createActionLog } from "@/lib/action-log";
import { authOptions } from "@/lib/auth";
import { generateSubmittalWriteup } from "@/lib/claude";
import { sendGmail } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { submittalToHtml, submittalToPlainText } from "@/lib/submittal-format";

// Local-candidate placement actions. Mirror the three RF actions (Apply /
// Submit / Reference Request) but never call RecruiterFlow. Placement rows
// for these candidates carry candidateId (cuid) with candidateRfId null.

type Result<T = void> =
  | (T extends void ? { ok: true } : { ok: true; value: T })
  | { ok: false; error: string };

async function requireUser(): Promise<{ id: string; email: string; name: string | null } | null> {
  const s = await getServerSession(authOptions);
  if (!s?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: s.user.email },
    select: { id: true, email: true, name: true },
  });
  if (!u || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name };
}

async function loadLocalCandidate(id: string) {
  return prisma.candidate.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      currentDesignation: true,
      currentOrganization: true,
      location: true,
      linkedinProfile: true,
      skills: true,
      notes: true,
      experience: true,
    },
  });
}

// ---- Apply ----

export type ApplyLocalInput = {
  candidateId: string;
  jobRfId: number;
  clientRfId: number;
};

export async function applyLocalCandidateToJob(input: ApplyLocalInput): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const existing = await prisma.placement.findUnique({
      where: { candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: input.jobRfId } },
      select: { id: true, stage: true },
    });
    if (existing) {
      return { ok: false, error: `Candidate already linked to this job (stage: ${existing.stage}).` };
    }

    await prisma.placement.create({
      data: {
        candidateId: input.candidateId,
        candidateRfId: null,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        stage: "applied",
        createdById: user.id,
        syncedToRf: false,
      },
    });

    await createActionLog({
      userId: user.id,
      actionType: "apply",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { jobRfId: input.jobRfId, clientRfId: input.clientRfId, local: true },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Apply failed." };
  }
}

// ---- Submit: generate writeup ----

export type GenerateLocalSubmittalInput = {
  candidateId: string;
  jobRfId: number;
};

export type GenerateLocalSubmittalResult =
  | { ok: true; value: { writeup: string } }
  | { ok: false; error: string };

type ExpRow = {
  designation?: string | null;
  organization?: string | null;
  from_year?: number | null;
  to_year?: number | null;
  description?: string | null;
};

export async function generateLocalSubmittal(
  input: GenerateLocalSubmittalInput,
): Promise<GenerateLocalSubmittalResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const c = await loadLocalCandidate(input.candidateId);
    if (!c) return { ok: false, error: "Candidate not found." };

    // Pull job details via RF read (read-side lookups of existing RF records
    // are still fine under the no-RF-on-create rule — we're not creating, just
    // reading job context to frame the writeup).
    const { recruiterflow } = await import("@/lib/recruiterflow");
    const [job, clients] = await Promise.all([
      recruiterflow.getJob(input.jobRfId).catch(() => null),
      recruiterflow.listAllClients({ perPage: 100 }).catch(() => []),
    ]);
    const clientName = (() => {
      if (!job?.company_id) return "";
      const cl = clients.find((x) => x.id === job.company_id);
      return cl?.name ?? "";
    })();

    const experienceRows = (c.experience as unknown as ExpRow[] | null) ?? [];
    const experienceSummary = experienceRows
      .slice(0, 6)
      .map((r) => {
        const role = [r.designation, r.organization].filter(Boolean).join(" at ");
        const years = [r.from_year, r.to_year ?? "present"].filter(Boolean).join("–");
        const line = [role, years].filter(Boolean).join(" (") + (years ? ")" : "");
        return r.description ? `${line}: ${r.description}` : line;
      })
      .filter(Boolean)
      .join("\n");

    const writeup = await generateSubmittalWriteup({
      candidate: {
        firstName: c.firstName,
        lastName: c.lastName ?? "",
        title: c.currentDesignation ?? "",
        employer: c.currentOrganization ?? "",
        location: c.location ?? "",
        skills: Array.isArray(c.skills) ? c.skills : [],
        experienceSummary,
        notes: c.notes ?? "",
        expectedSalary: "",
        linkedin: c.linkedinProfile ?? "",
      },
      job: {
        title: job?.title ?? "(job)",
        clientName,
        locations: Array.isArray(job?.locations)
          ? (job!.locations as { location?: string }[]).map((l) => l.location ?? "").filter(Boolean)
          : [],
        salaryRange: undefined,
        employmentType: undefined,
        jobType: undefined,
        department: undefined,
        experienceRange: undefined,
        description: typeof job?.description === "string" ? job.description : undefined,
        customFields: [],
      },
    });

    return { ok: true, value: { writeup } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to generate submittal." };
  }
}

// ---- Submit: send email + create Placement ----

export type SendLocalSubmittalInput = {
  candidateId: string;
  jobRfId: number;
  clientRfId: number;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
};

export type SendLocalSubmittalResult =
  | { ok: true; value: { placementId: string; gmailMessageId: string } }
  | { ok: false; error: string };

export async function sendLocalSubmittalEmail(
  input: SendLocalSubmittalInput,
): Promise<SendLocalSubmittalResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.to.length) return { ok: false, error: "At least one recipient is required." };
  if (!input.subject.trim()) return { ok: false, error: "Subject is required." };
  if (!input.bodyText.trim()) return { ok: false, error: "Body is required." };

  try {
    const sendResult = await sendGmail({
      userId: user.id,
      from: user.email,
      fromName: user.name ?? undefined,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: submittalToPlainText(input.bodyText),
      bodyHtml: submittalToHtml(input.bodyText),
    });

    const placement = await prisma.placement.upsert({
      where: {
        candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: input.jobRfId },
      },
      create: {
        candidateId: input.candidateId,
        candidateRfId: null,
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        stage: "submitted",
        createdById: user.id,
        syncedToRf: false,
      },
      update: { stage: "submitted", syncedToRf: false },
      select: { id: true },
    });

    await createActionLog({
      userId: user.id,
      actionType: "submit",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: {
        jobRfId: input.jobRfId,
        clientRfId: input.clientRfId,
        gmailMessageId: sendResult.id,
        local: true,
      },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");
    return { ok: true, value: { placementId: placement.id, gmailMessageId: sendResult.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}

// ---- Reference request: send email only (no placement) ----

export type SendLocalReferenceInput = {
  candidateId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
};

export type SendLocalReferenceResult =
  | { ok: true; value: { gmailMessageId: string } }
  | { ok: false; error: string };

export async function sendLocalReferenceRequest(
  input: SendLocalReferenceInput,
): Promise<SendLocalReferenceResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.to.length) return { ok: false, error: "At least one recipient is required." };
  if (!input.subject.trim()) return { ok: false, error: "Subject is required." };
  if (!input.bodyText.trim()) return { ok: false, error: "Body is required." };

  try {
    const sendResult = await sendGmail({
      userId: user.id,
      from: user.email,
      fromName: user.name ?? undefined,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: input.bodyText,
    });

    await createActionLog({
      userId: user.id,
      actionType: "reference_check_request",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { gmailMessageId: sendResult.id, local: true },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    return { ok: true, value: { gmailMessageId: sendResult.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}
