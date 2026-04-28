"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { createActionLog } from "@/lib/action-log";
import { logActivity } from "@/lib/activity";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { generateSubmittalWriteup } from "@/lib/claude";
import { sendGmail } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { submittalToHtml, submittalToPlainText } from "@/lib/submittal-format";
import { fireTriggerAndLog } from "@/lib/trigger-fire";
import {
  CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
  CANDIDATE_CONFIRMATION_TRIGGER,
  CANDIDATE_REJECTION_TRIGGER,
} from "@/app/settings/template-constants";

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

// Phase 2: `jobRfId` + `clientRfId` are optional — callers pass a cuid
// (jobId / clientId) when the target is Ace-native. Exactly one of
// {jobRfId, jobId} should be set; same for clients. When jobId is set,
// jobRfId is written as null and the Placement points at Job via the
// cuid FK, and symmetrically for Client.
export type ApplyLocalInput = {
  candidateId: string;
  jobRfId?: number | null;
  jobId?: string | null;
  clientRfId?: number | null;
  clientId?: string | null;
};

export async function applyLocalCandidateToJob(input: ApplyLocalInput): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const jobRfId = input.jobRfId ?? null;
  const jobId = input.jobId ?? null;
  const clientRfId = input.clientRfId ?? null;
  const clientId = input.clientId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };

  try {
    // Dupe check by whichever identity key is available. Ace-native
    // jobs use the (candidateId, jobId) unique index; RF-imported jobs
    // use (candidateId, jobRfId).
    const existing = jobId
      ? await prisma.placement.findUnique({
          where: { candidateId_jobId: { candidateId: input.candidateId, jobId } },
          select: { id: true, stage: true },
        })
      : await prisma.placement.findUnique({
          where: { candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: jobRfId! } },
          select: { id: true, stage: true },
        });
    if (existing) {
      return { ok: false, error: `Candidate already linked to this job (stage: ${existing.stage}).` };
    }

    const org = await getCurrentOrg();
    await prisma.placement.create({
      data: {
        candidateId: input.candidateId,
        candidateRfId: null,
        jobRfId,
        jobId,
        clientRfId,
        clientId,
        stage: "applied",
        source: "recruiter_applied",
        createdById: user.id,
        organizationId: org.id,
        syncedToRf: false,
      },
    });

    await createActionLog({
      userId: user.id,
      actionType: "apply",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { jobRfId, jobId, clientRfId, clientId, local: true },
    });

    // Phase 4d: ActivityLog audit-feed entry for the Ace-native apply
    // path. Mirrors the RF-imported applyCandidateToJob log so both
    // profile variants land under the same actionType.
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "candidate_applied_to_job",
      targetType: "candidate",
      targetId: input.candidateId,
      metadata: {
        jobId: jobId ?? null,
        jobRfId: jobRfId ?? null,
        clientId: clientId ?? null,
        clientRfId: clientRfId ?? null,
        local: true,
      },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");

    // Auto-fire Candidate Applied — Confirmation. Best-effort tail
    // off the apply path; the Placement row + ActivityLog are
    // already saved, so a missing template / inactive template /
    // Anthropic timeout never corrupts pipeline state.
    // Awaited (not void) — on Vercel serverless, a floating promise
    // gets cut off when the function returns, so the Gmail send
    // never lands. Worth the ~1s of extra latency to make sure the
    // candidate actually receives the templated follow-up.
    await fireTriggerAndLog({
      trigger: CANDIDATE_APPLIED_CONFIRMATION_TRIGGER,
      ref: {
        candidateId: input.candidateId,
        jobRfId,
        jobId,
        clientRfId,
        clientId,
      },
      actionType: "candidate_applied_confirmation_email",
      organizationId: org.id,
      metadata: { jobRfId, jobId, clientRfId, clientId, local: true },
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Apply failed." };
  }
}

// ---- Submit: generate writeup ----

export type GenerateLocalSubmittalInput = {
  candidateId: string;
  // Either jobRfId (RF-imported job) or jobId (Ace-native cuid) — at
  // least one must be set. Writeup generation reads job metadata from
  // whichever is present.
  jobRfId?: number | null;
  jobId?: string | null;
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

    const jobRfId = input.jobRfId ?? null;
    const jobId = input.jobId ?? null;
    if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };

    // Phase 5: resolve job metadata entirely from Neon. RF-imported
    // jobs look up via legacyRfId; Ace-native via cuid. Either path
    // returns the columns + client join we need for the writeup.
    const jobRow = await (jobId
      ? prisma.job.findUnique({
          where: { id: jobId },
          select: {
            title: true,
            locations: true,
            description: true,
            raw: true,
            client: { select: { name: true } },
          },
        })
      : jobRfId != null
        ? prisma.job.findFirst({
            where: { legacyRfId: jobRfId },
            select: {
              title: true,
              locations: true,
              description: true,
              raw: true,
              client: { select: { name: true } },
            },
          })
        : Promise.resolve(null));
    const rawJob = (jobRow?.raw ?? null) as { description?: unknown; title?: string; company_id?: number } | null;
    const clientName = jobRow?.client?.name ?? "";

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
        title: jobRow?.title ?? rawJob?.title ?? "(job)",
        clientName,
        locations: Array.isArray(jobRow?.locations) ? jobRow!.locations : [],
        salaryRange: undefined,
        employmentType: undefined,
        jobType: undefined,
        department: undefined,
        experienceRange: undefined,
        description:
          jobRow?.description ??
          (typeof rawJob?.description === "string" ? rawJob.description : undefined),
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
  jobRfId?: number | null;
  jobId?: string | null;
  clientRfId?: number | null;
  clientId?: string | null;
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

    const jobRfId = input.jobRfId ?? null;
    const jobId = input.jobId ?? null;
    const clientRfId = input.clientRfId ?? null;
    const clientId = input.clientId ?? null;
    if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };

    const org = await getCurrentOrg();

    // Upsert keyed on whichever identity the caller supplied — mirrors
    // the Apply dupe-check logic so resubmits to the same job land on
    // the existing row.
    const placement = jobId
      ? await prisma.placement.upsert({
          where: { candidateId_jobId: { candidateId: input.candidateId, jobId } },
          create: {
            candidateId: input.candidateId,
            candidateRfId: null,
            jobRfId,
            jobId,
            clientRfId,
            clientId,
            stage: "submitted",
            source: "recruiter_applied",
            createdById: user.id,
            organizationId: org.id,
            syncedToRf: false,
          },
          update: { stage: "submitted", syncedToRf: false },
          select: { id: true },
        })
      : await prisma.placement.upsert({
          where: {
            candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: jobRfId! },
          },
          create: {
            candidateId: input.candidateId,
            candidateRfId: null,
            jobRfId,
            jobId,
            clientRfId,
            clientId,
            stage: "submitted",
            source: "recruiter_applied",
            createdById: user.id,
            organizationId: org.id,
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
        jobRfId,
        jobId,
        clientRfId,
        clientId,
        gmailMessageId: sendResult.id,
        local: true,
      },
    });

    // Phase 4c: ActivityLog — Ace-native candidate submittal path.
    // Mirrors the RF-imported sendSubmittalEmail audit entry so both
    // profile variants land a submittal_sent row on the same targetType
    // (placement) with the same metadata shape.
    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "submittal_sent",
      targetType: "placement",
      targetId: placement.id,
      metadata: {
        jobId: jobId ?? null,
        jobRfId: jobRfId ?? null,
        candidateId: input.candidateId,
        clientId: clientId ?? null,
        clientRfId: clientRfId ?? null,
        local: true,
      },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");

    // Auto-fire Candidate Submission Confirmation to the candidate.
    // Mirrors the RF-side createCandidateConfirmationDraft path so
    // the candidate gets the same "Great News — your profile was
    // submitted" follow-up no matter which candidate type they are.
    // Awaited (not void) — on Vercel serverless, a floating promise
    // gets cut off when the function returns, so the Gmail send
    // never lands. Worth the ~1s of extra latency to make sure the
    // candidate actually receives the templated follow-up.
    await fireTriggerAndLog({
      trigger: CANDIDATE_CONFIRMATION_TRIGGER,
      ref: {
        candidateId: input.candidateId,
        jobRfId,
        jobId,
        clientRfId,
        clientId,
      },
      actionType: "candidate_submission_confirmation_email",
      organizationId: org.id,
      metadata: {
        placementId: placement.id,
        submittalGmailMessageId: sendResult.id,
        local: true,
      },
    });

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


// Reject a Placement on the Ace-native candidate path. The shared
// rejectCandidateJob in placement-actions.ts is keyed on the
// (candidateRfId, jobRfId) compound unique which Ace-native rows
// dont have, so this thin helper writes the same stage move +
// ActionLog entry, keyed off the Placement.id cuid that LocalJobRow
// already carries. Mirrors the RF version's revalidate paths.
export async function rejectLocalPlacement(input: { placementId: string }): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const org = await getCurrentOrg();
  try {
    const placement = await prisma.placement.findFirst({
      where: { id: input.placementId, organizationId: org.id },
      select: {
        id: true,
        stage: true,
        candidateId: true,
        candidateRfId: true,
        jobId: true,
        jobRfId: true,
        clientId: true,
        clientRfId: true,
      },
    });
    if (!placement) return { ok: false, error: "Placement not found." };
    const previousStage = placement.stage;
    await prisma.placement.update({
      where: { id: input.placementId },
      data: { stage: "rejected", syncedToRf: false, invoicingFlagged: false },
    });
    await createActionLog({
      userId: user.id,
      actionType: "reject",
      subjectType: "candidate",
      subjectId: placement.candidateId ?? String(placement.candidateRfId ?? ""),
      metadata: {
        placementId: input.placementId,
        jobId: placement.jobId,
        jobRfId: placement.jobRfId,
        clientId: placement.clientId,
        clientRfId: placement.clientRfId,
        previousStage,
        local: true,
      },
    });
    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    revalidatePath(`/pipeline`);

    // Auto-fire Candidate Rejected. Same best-effort pattern: the
    // stage flip is already committed, so a fire failure can't
    // corrupt the pipeline. Only fires when we have a candidateId
    // (every Ace-native row does); RF rejections still flow through
    // the older sendRejectionEmail path.
    if (placement.candidateId) {
      // Awaited (not void) — on Vercel serverless, a floating promise
    // gets cut off when the function returns, so the Gmail send
    // never lands. Worth the ~1s of extra latency to make sure the
    // candidate actually receives the templated follow-up.
    await fireTriggerAndLog({
        trigger: CANDIDATE_REJECTION_TRIGGER,
        ref: {
          candidateId: placement.candidateId,
          candidateRfId: placement.candidateRfId,
          jobId: placement.jobId,
          jobRfId: placement.jobRfId,
          clientId: placement.clientId,
          clientRfId: placement.clientRfId,
        },
        actionType: "candidate_rejection_email",
        organizationId: org.id,
        metadata: {
          placementId: input.placementId,
          previousStage,
          local: true,
        },
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reject candidate." };
  }
}
