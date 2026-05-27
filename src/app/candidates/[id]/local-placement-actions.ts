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
  OFFER_ACCEPTANCE_TRIGGER,
  OFFER_EXTENDED_TRIGGER,
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
    const org = await getCurrentOrg();
    if (existing) {
      // Pre-pipeline stages (sourced / applied / kept) can all transition
      // to "applied" — Apply is the natural promotion path off Kept and
      // a no-op refresh off Applied/Sourced. Anything past Applied is a
      // real pipeline state we won't silently downgrade.
      const PRE_PIPELINE_STAGES = new Set(["sourced", "applied", "kept"]);
      if (!PRE_PIPELINE_STAGES.has(existing.stage)) {
        return { ok: false, error: `Candidate already linked to this job (stage: ${existing.stage}).` };
      }
      await prisma.placement.update({
        where: { id: existing.id },
        data: { stage: "applied", syncedToRf: false },
      });
    } else {
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
    }

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

// ---- Keep (Ace-native candidate ↔ Job) ----
//
// Mirrors the RF-side keepCandidate (placement-actions.ts) but uses
// candidateId (cuid) instead of candidateRfId. Writes Placement.stage="kept"
// so the candidate surfaces in the job's Kept tab on /jobs/[id]. The
// candidate-level Candidate.tags["kept"] marker stays out of this path —
// Placement.stage is the source of truth (CLAUDE.md rule 13). At least one
// of {jobRfId, jobId} must be set, mirroring applyLocalCandidateToJob.

export type KeepLocalForJobInput = {
  candidateId: string;
  jobRfId?: number | null;
  jobId?: string | null;
  clientRfId?: number | null;
  clientId?: string | null;
};

export async function keepLocalCandidateForJob(input: KeepLocalForJobInput): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const jobRfId = input.jobRfId ?? null;
  const jobId = input.jobId ?? null;
  const clientRfId = input.clientRfId ?? null;
  const clientId = input.clientId ?? null;
  if (jobRfId == null && !jobId) return { ok: false, error: "Missing job reference." };

  const org = await getCurrentOrg();
  try {
    // Two unique indexes back the upsert path — (candidateId, jobId) for
    // Ace-native Jobs and (candidateId, jobRfId) for RF-imported Jobs. We
    // pick whichever identity the caller supplied so the same row is
    // updated whether the recruiter is on the legacy or the cuid path.
    if (jobId) {
      await prisma.placement.upsert({
        where: { candidateId_jobId: { candidateId: input.candidateId, jobId } },
        create: {
          candidateId: input.candidateId,
          candidateRfId: null,
          jobRfId,
          jobId,
          clientRfId,
          clientId,
          stage: "kept",
          // No source stamp — mirrors RF keepCandidate's create branch.
          // Source is only stamped on first Apply so Applicants can render
          // "Recruiter Applied"; Kept rows leave it null and the column
          // shows "—" for them.
          createdById: user.id,
          organizationId: org.id,
          syncedToRf: false,
        },
        update: { stage: "kept", syncedToRf: false },
      });
    } else {
      await prisma.placement.upsert({
        where: { candidateId_jobRfId: { candidateId: input.candidateId, jobRfId: jobRfId! } },
        create: {
          candidateId: input.candidateId,
          candidateRfId: null,
          jobRfId,
          jobId,
          clientRfId,
          clientId,
          stage: "kept",
          // No source stamp — mirrors RF keepCandidate's create branch.
          // Source is only stamped on first Apply so Applicants can render
          // "Recruiter Applied"; Kept rows leave it null and the column
          // shows "—" for them.
          createdById: user.id,
          organizationId: org.id,
          syncedToRf: false,
        },
        update: { stage: "kept", syncedToRf: false },
      });
    }

    await createActionLog({
      userId: user.id,
      actionType: "keep",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { jobRfId, jobId, clientRfId, clientId, local: true },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    if (jobId) revalidatePath(`/jobs/${jobId}`);
    if (jobRfId != null) revalidatePath(`/jobs/${jobRfId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Keep failed." };
  }
}

// Stage reversion for an Ace-native candidate: flip an existing kept
// Placement back to "applied". Used by the profile Keep button when the
// recruiter removes a candidate from Kept. Mirrors RF moveToApplied but
// scoped by placement.id (cuid) so it works for either job-identity shape.
export type RevertLocalKeepInput = {
  candidateId: string;
  placementId: string;
};

export async function revertLocalKeepToApplied(input: RevertLocalKeepInput): Promise<Result> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const org = await getCurrentOrg();
  try {
    // Org-scope the update so cross-tenant placement ids can't be flipped
    // by a stale client. updateMany returns count=0 if the row doesn't
    // belong to the caller's org; we surface that as a not-found error
    // rather than silently succeeding.
    const result = await prisma.placement.updateMany({
      where: {
        id: input.placementId,
        candidateId: input.candidateId,
        organizationId: org.id,
        stage: "kept",
      },
      data: { stage: "applied", syncedToRf: false },
    });
    if (result.count === 0) {
      return { ok: false, error: "Kept placement not found for this candidate." };
    }

    await createActionLog({
      userId: user.id,
      actionType: "revert_to_applied",
      subjectType: "candidate",
      subjectId: input.candidateId,
      metadata: { placementId: input.placementId, fromStage: "kept", toStage: "applied", local: true },
    });

    revalidatePath(`/candidates/${input.candidateId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revert failed." };
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
  // When false, suppress the post-submittal candidate confirmation
  // trigger for this one send. Defaults to firing (undefined / true) so
  // existing callers keep the auto-confirmation behavior.
  sendCandidateConfirmation?: boolean;
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
    // the candidate gets the same "Great News - your profile was
    // submitted" follow-up no matter which candidate type they are.
    // Awaited (not void) - on Vercel serverless, a floating promise
    // gets cut off when the function returns, so the Gmail send
    // never lands. Worth the ~1s of extra latency to make sure the
    // candidate actually receives the templated follow-up.
    // Suppressed for this send when the "Send candidate confirmation
    // email" checkbox was unchecked (sendCandidateConfirmation === false).
    if (input.sendCandidateConfirmation !== false) {
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
    }

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
export async function rejectLocalPlacement(input: {
  placementId: string;
  // Recruiter-driven choice in the reject dialog. The trigger is no
  // longer auto-fired on every reject — the UI prompts and passes
  // this flag through. Default false so any caller that hasn't been
  // updated to surface the prompt still rejects silently.
  sendRejectionEmail?: boolean;
}): Promise<Result> {
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

    // Recruiter-driven send. The Reject dialog surfaces a "Send
    // rejection email" checkbox; only fire when they ticked it. Stage
    // flip is already committed, so a fire failure can't corrupt
    // pipeline state — best-effort.
    if (input.sendRejectionEmail && placement.candidateId) {
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

// Reapply for an Ace-native rejected Placement. Deletes the row so the
// candidate has a clean slate for that job — same semantics as the
// onUnrejectViaDelete path on the RF side, mirrored here for local
// candidates where Placement.stage is the canonical source of truth.
// Scoped by organizationId so a recruiter on a different org can't
// touch our rows.
export async function reapplyLocalPlacement(input: {
  placementId: string;
}): Promise<Result> {
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
    if (placement.stage !== "rejected" && placement.stage !== "cancelled") {
      return { ok: false, error: "Only rejected or cancelled placements can be reapplied." };
    }
    // Reapply moves the row to "applied" stage so the candidate appears
    // on /applicants and the job pill stays visible on their profile.
    // Previous behavior deleted the row entirely, which dropped them
    // from Applicants and wiped the pill.
    await prisma.placement.update({
      where: { id: input.placementId },
      data: { stage: "applied", syncedToRf: false, invoicingFlagged: false },
    });
    await createActionLog({
      userId: user.id,
      actionType: "reapply_local_placement",
      subjectType: "candidate",
      subjectId: placement.candidateId ?? String(placement.candidateRfId ?? ""),
      metadata: {
        placementId: input.placementId,
        jobId: placement.jobId,
        jobRfId: placement.jobRfId,
        clientId: placement.clientId,
        clientRfId: placement.clientRfId,
        previousStage: placement.stage,
        target: "applied",
        local: true,
      },
    });
    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to reapply candidate." };
  }
}

// Dismiss a placement off the candidate profile entirely. Backs the faint
// X on every job pill (both the Ace-native LocalJobActionRow and the
// RF-imported JobActionRow renderers). Org-scoped via findFirst so a
// recruiter on a different org can't delete our rows. Hard delete: the
// pill disappears, the candidate drops off that job's pipeline, and
// /applicants stops listing them for it. The button's inline confirm is
// the only guard against an accidental click.
export async function dismissPlacementFromProfile(input: {
  placementId: string;
}): Promise<Result> {
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
    await prisma.placement.delete({ where: { id: input.placementId } });
    await createActionLog({
      userId: user.id,
      actionType: "dismiss_placement_from_profile",
      subjectType: "candidate",
      subjectId: placement.candidateId ?? String(placement.candidateRfId ?? ""),
      metadata: {
        placementId: input.placementId,
        jobId: placement.jobId,
        jobRfId: placement.jobRfId,
        clientId: placement.clientId,
        clientRfId: placement.clientRfId,
        previousStage: placement.stage,
      },
    });
    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    if (placement.candidateRfId != null) revalidatePath(`/candidates/${placement.candidateRfId}`);
    revalidatePath(`/pipeline`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to remove placement." };
  }
}

// ---- Extend Offer (Ace-native) ----

// Mirrors recordOffer (placement-actions.ts) for Ace-native Placement rows
// that carry candidateId (cuid) with candidateRfId null. The RF version keys
// the upsert off (candidateRfId, jobRfId), which won't match an Ace-native
// row — so this one looks the placement up by its cuid id and updates in
// place. Same Scoreboard rule applies: feeTotal must be > 0 because the
// Pipeline Value KPI sums it across offer + pending_start rows; a null fee
// would silently drop the deal out of the forecast.
export type RecordLocalOfferInput = {
  placementId: string;
  salary: number | null;
  currency: string;
  title: string;
  startDate: string | null; // ISO date
  notes: string;
  feePercentage: number | null;
  feeTotal: number;
  minFee: number | null;
};

export async function recordLocalOffer(
  input: RecordLocalOfferInput,
): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (input.feeTotal == null || input.feeTotal <= 0) {
    return { ok: false, error: "Fee amount is required at this stage." };
  }
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
    const startDate = input.startDate ? new Date(input.startDate) : null;
    const previousStage = placement.stage;

    const row = await prisma.placement.update({
      where: { id: input.placementId },
      data: {
        stage: "offer",
        offerReceivedAt: new Date(),
        offerSalary: input.salary ?? null,
        offerCurrency: input.currency || "USD",
        offerTitle: input.title || null,
        offerStartDate: startDate,
        offerNotes: input.notes || null,
        // Mirror offered salary into acceptedSalary at offer time so the
        // Hired-tab Salary column is populated even if PlacementDialog
        // isn't opened to type it in again — matches the RF recordOffer
        // semantics.
        acceptedSalary: input.salary ?? null,
        acceptedCurrency: input.currency || "USD",
        feePercentage: input.feePercentage,
        feeTotal: input.feeTotal,
        minFee: input.minFee,
        // Ace-native rows never sync to RF; keep the flag false so the
        // pill's "(Ace only)" indicator stays accurate.
        syncedToRf: false,
      },
      select: { id: true },
    });

    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "offer_extended",
      targetType: "placement",
      targetId: row.id,
      metadata: {
        offerAmount: input.salary ?? null,
        currency: input.currency || "USD",
        title: input.title || null,
        startDate: input.startDate ?? null,
        candidateId: placement.candidateId,
        jobId: placement.jobId,
        jobRfId: placement.jobRfId,
        clientId: placement.clientId,
        clientRfId: placement.clientRfId,
        previousStage,
        local: true,
      },
    });

    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    if (placement.candidateRfId != null) revalidatePath(`/candidates/${placement.candidateRfId}`);
    revalidatePath(`/pipeline`);

    // Auto-fire the Offer Extended template to the candidate, same as
    // the RF recordOffer flow. Trigger metadata routes through
    // fireTriggerAndLog by candidateId for Ace-native candidates.
    if (placement.candidateId) {
      await fireTriggerAndLog({
        trigger: OFFER_EXTENDED_TRIGGER,
        ref: {
          candidateId: placement.candidateId,
          candidateRfId: placement.candidateRfId,
          jobId: placement.jobId,
          jobRfId: placement.jobRfId,
          clientId: placement.clientId,
          clientRfId: placement.clientRfId,
        },
        actionType: "offer_extended_email",
        organizationId: org.id,
        overrides: {
          jobTitle: input.title,
        },
        metadata: {
          placementId: row.id,
          previousStage,
          local: true,
        },
      });
    }

    return { ok: true, value: { id: row.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to record offer." };
  }
}

// ---- Record Placement (Ace-native, offer accepted) ----
//
// Ace-native counterpart to recordPlacement (placement-actions.ts).
// Keys the update off placement.id rather than the (candidateRfId,
// jobRfId) composite because Ace-native rows carry candidateRfId: null.
// Slimmer than the RF version: just the essential fields needed to
// move the row to pending_start (accepted salary + fee + start date +
// billing/hiring contacts + notes). The multi-contact + custom-payment-
// terms drawer is still RF-only; Ace-native recruiters can edit those
// later via the /pipeline placement-edit row drawer once needed.
export type RecordLocalPlacementInput = {
  placementId: string;
  acceptedSalary: number;
  acceptedCurrency: string;
  feePercentage: number | null;
  feeTotal: number;
  minFee: number | null;
  guaranteePeriodDays: number | null;
  billingContactName: string;
  billingContactEmail: string;
  hiringManagerName: string;
  hiringManagerEmail: string;
  expectedStartDate: string; // ISO YYYY-MM-DD
  notes: string;
  // Recruiter-tagged lead source. Free-form so legacy seed values
  // (Pin, Apollo BD) keep working; the dialog renders a fixed
  // dropdown of canonical channels but stores free text.
  candidateSource?: string | null;
};

export async function recordLocalPlacement(
  input: RecordLocalPlacementInput,
): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.expectedStartDate) {
    return { ok: false, error: "Expected start date is required." };
  }
  if (input.feeTotal == null || input.feeTotal <= 0) {
    return { ok: false, error: "Fee amount is required at this stage." };
  }
  const org = await getCurrentOrg();
  try {
    const placement = await prisma.placement.findFirst({
      where: { id: input.placementId, organizationId: org.id },
      select: {
        id: true,
        stage: true,
        placedAt: true,
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
    const trimmedSource = input.candidateSource?.trim();

    const row = await prisma.placement.update({
      where: { id: input.placementId },
      data: {
        stage: "pending_start",
        // Stamp placedAt only on first transition into pending_start so
        // re-edits don't keep bumping the timestamp forward. Same rule
        // the RF recordPlacement uses.
        placedAt: placement.placedAt ?? new Date(),
        acceptedSalary: input.acceptedSalary,
        acceptedCurrency: input.acceptedCurrency || "USD",
        feePercentage: input.feePercentage,
        feeTotal: input.feeTotal,
        minFee: input.minFee,
        guaranteePeriodDays: input.guaranteePeriodDays,
        billingContactName: input.billingContactName.trim() || null,
        billingContactEmail: input.billingContactEmail.trim() || null,
        hiringManagerName: input.hiringManagerName.trim() || null,
        hiringManagerEmail: input.hiringManagerEmail.trim() || null,
        expectedStartDate: new Date(input.expectedStartDate),
        placementNotes: input.notes.trim() || null,
        candidateSource: trimmedSource || null,
        // Ace-native placements never round-trip to RF; keep the flag
        // pinned to false so the pill's source-of-truth indicator is
        // accurate (no false "synced" banner).
        syncedToRf: false,
      },
      select: { id: true },
    });

    await logActivity({
      organizationId: org.id,
      userId: user.id,
      actionType: "placement_recorded",
      targetType: "placement",
      targetId: row.id,
      metadata: {
        acceptedSalary: input.acceptedSalary,
        currency: input.acceptedCurrency || "USD",
        feeTotal: input.feeTotal,
        feePercentage: input.feePercentage,
        startDate: input.expectedStartDate,
        candidateId: placement.candidateId,
        jobId: placement.jobId,
        jobRfId: placement.jobRfId,
        clientId: placement.clientId,
        clientRfId: placement.clientRfId,
        previousStage,
        local: true,
      },
    });

    if (placement.candidateId) revalidatePath(`/candidates/${placement.candidateId}`);
    if (placement.candidateRfId != null) revalidatePath(`/candidates/${placement.candidateRfId}`);
    revalidatePath(`/pipeline`);
    revalidatePath(`/dashboard`);

    // Auto-fire the Offer Accepted template to the client (with the
    // candidate CCed by template wiring). Mirrors the RF recordPlacement
    // tail. The fire helper is identity-agnostic — pass both ids and it
    // picks the right channel.
    if (placement.candidateId) {
      const startDateLabel = new Date(input.expectedStartDate).toLocaleDateString();
      await fireTriggerAndLog({
        trigger: OFFER_ACCEPTANCE_TRIGGER,
        ref: {
          candidateId: placement.candidateId,
          candidateRfId: placement.candidateRfId,
          jobId: placement.jobId,
          jobRfId: placement.jobRfId,
          clientId: placement.clientId,
          clientRfId: placement.clientRfId,
        },
        actionType: "offer_acceptance_email",
        organizationId: org.id,
        overrides: { startDate: startDateLabel },
        metadata: {
          placementId: row.id,
          startDate: startDateLabel,
          previousStage,
          local: true,
        },
      });
    }

    return { ok: true, value: { id: row.id } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to record placement." };
  }
}
