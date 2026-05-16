import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildPlacementMergeValues,
  type BuildPlacementMergeContextInput,
} from "@/lib/merge-context";
import {
  fireTemplatedEmail,
  type FireResult,
} from "@/lib/templated-email";
import { logActivity } from "@/lib/activity";
import type { MergeFieldValues } from "@/lib/merge-fields";

// Identity-agnostic trigger fire helper. Replaces the RF-only
// fireTriggerForCandidateJob in placement-actions.ts. Accepts a
// placement-style ref carrying either RF numeric ids OR cuids (or
// both — RF imports always have both populated). Looks up the
// candidate's email when none was supplied so existing call sites
// don't have to plumb it through.
//
// Lives in src/lib/ (not in a "use server" file) so it can be
// imported from action files on either the RF or Ace-native paths
// without becoming an RPC server action surface.

export type FireTriggerRef = {
  candidateRfId?: number | null;
  candidateId?: string | null;
  jobRfId?: number | null;
  jobId?: string | null;
  clientRfId?: number | null;
  clientId?: string | null;
};

export type FireTriggerInput = {
  trigger: string;
  ref: FireTriggerRef;
  // Explicit recipients win over the candidate-email lookup. When
  // omitted, the helper resolves the candidate's email via the
  // ref and uses that. Pass [] to skip the auto-lookup (and the
  // fire will skip with reason="no_recipient").
  to?: string[];
  cc?: string[];
  // Per-trigger overrides applied on top of the resolved merge
  // values. Used when the caller already has authoritative formatted
  // strings ([Offer Amount], [Start Date], [Interview Date Time]).
  overrides?: Partial<MergeFieldValues>;
  mode?: "send" | "draft";
  // Per-org TriggerRule override knobs, surfaced here so callers that
  // skip fireTriggerAndLog (the rare direct fireTriggerForPlacement
  // path) can still honor a saved rule.
  templateOverrideId?: string | null;
  forceDraft?: boolean;
};

export type FireTriggerOutcome = {
  fire: FireResult;
  candidateEmail: string;
};

export async function fireTriggerForPlacement(
  input: FireTriggerInput,
): Promise<FireTriggerOutcome> {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email ?? "";
  const userName = session?.user?.name ?? null;
  const user = userEmail
    ? await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } })
    : null;
  if (!user) {
    return {
      fire: { status: "error", error: "Not signed in." },
      candidateEmail: "",
    };
  }

  const mergeInput: BuildPlacementMergeContextInput = {
    candidateRfId: input.ref.candidateRfId ?? null,
    candidateId: input.ref.candidateId ?? null,
    jobRfId: input.ref.jobRfId ?? null,
    jobId: input.ref.jobId ?? null,
    clientRfId: input.ref.clientRfId ?? null,
    clientId: input.ref.clientId ?? null,
    overrides: input.overrides,
  };
  const values = await buildPlacementMergeValues(mergeInput);

  const candidateEmail = values.candidateEmail ?? "";
  const to =
    input.to !== undefined
      ? input.to.map((e) => e.trim()).filter(Boolean)
      : candidateEmail
        ? [candidateEmail]
        : [];

  const fire = await fireTemplatedEmail({
    trigger: input.trigger,
    userId: user.id,
    fromEmail: userEmail,
    fromName: userName,
    to,
    cc: input.cc ?? [],
    values,
    mode: input.mode ?? "send",
    templateOverrideId: input.templateOverrideId ?? null,
    forceDraft: input.forceDraft ?? false,
  });

  return { fire, candidateEmail };
}

// Fire-and-log convenience wrapper. Routes the result through
// ActivityLog so the audit feed shows whether the trigger landed,
// got skipped (template missing / inactive / no recipient), or
// errored. Mirrors the pattern the RF callers use with logFire.
export async function fireTriggerAndLog(args: {
  trigger: string;
  ref: FireTriggerRef;
  actionType: string;
  to?: string[];
  cc?: string[];
  overrides?: Partial<MergeFieldValues>;
  mode?: "send" | "draft";
  // Optional metadata stamped onto the audit row alongside the fire
  // status. Use this to pin whatever trace fields the action path
  // wants surfaced (placementId, scheduledAt, offerAmount, etc.).
  metadata?: Record<string, unknown>;
  // Org id is required for ActivityLog. Caller should pass
  // (await getCurrentOrg()).id from inside its action.
  organizationId: string;
}): Promise<FireTriggerOutcome> {
  // Per-org TriggerRule override lookup. Absent row → default
  // behavior. enabled=false → short-circuit skip and log. templateId
  // → pinned template via templateOverrideId. sendAsDraft → force
  // draft regardless of caller mode and template-level flag.
  const rule = await prisma.triggerRule.findUnique({
    where: {
      organizationId_triggerKey: {
        organizationId: args.organizationId,
        triggerKey: args.trigger,
      },
    },
    select: { enabled: true, sendAsDraft: true, templateId: true },
  });

  if (rule && rule.enabled === false) {
    const sessionForUser = await getServerSession(authOptions);
    const emailForUser = sessionForUser?.user?.email ?? "";
    const userRow = emailForUser
      ? await prisma.user.findUnique({
          where: { email: emailForUser },
          select: { id: true },
        })
      : null;
    if (userRow && args.ref.candidateId) {
      try {
        await logActivity({
          organizationId: args.organizationId,
          userId: userRow.id,
          actionType: args.actionType,
          targetType: "candidate",
          targetId: args.ref.candidateId,
          metadata: {
            ...(args.metadata ?? {}),
            trigger: args.trigger,
            fireStatus: "skipped",
            fireDetail: { reason: "trigger_disabled" },
          },
        });
      } catch {
        // Audit-feed write is observability, never blocks the fire path.
      }
    }
    return {
      fire: { status: "skipped", reason: "trigger_disabled" },
      candidateEmail: "",
    };
  }

  const outcome = await fireTriggerForPlacement({
    trigger: args.trigger,
    ref: args.ref,
    to: args.to,
    cc: args.cc,
    overrides: args.overrides,
    mode: args.mode,
    templateOverrideId: rule?.templateId ?? null,
    forceDraft: rule?.sendAsDraft ?? false,
  });

  // Targeted ActivityLog write so the candidate / placement timeline
  // shows the fire result. targetType is 'candidate' when we have a
  // candidateId cuid, otherwise we fall back to the placement (the
  // RF path traditionally logs against the candidate's rfId-as-string,
  // which is fine for the audit feed but harder to join from cuid
  // queries).
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email ?? "";
  const user = userEmail
    ? await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } })
    : null;

  const fire = outcome.fire;
  const fireDetail =
    fire.status === "sent"
      ? {
          gmailMessageId: fire.result.id,
          gmailThreadId: fire.result.threadId,
          subject: fire.subject,
        }
      : fire.status === "drafted"
        ? {
            gmailDraftId: fire.result.id,
            gmailThreadId: fire.result.threadId,
            subject: fire.subject,
          }
        : fire.status === "skipped"
          ? { reason: fire.reason }
          : { error: fire.error };

  if (user && args.ref.candidateId) {
    try {
      await logActivity({
        organizationId: args.organizationId,
        userId: user.id,
        actionType: args.actionType,
        targetType: "candidate",
        targetId: args.ref.candidateId,
        metadata: {
          ...(args.metadata ?? {}),
          trigger: args.trigger,
          fireStatus: fire.status,
          fireDetail,
        },
      });
    } catch {
      // Audit-feed write is observability, never blocks the fire.
    }
  }

  return outcome;
}
