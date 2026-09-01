"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { GoalMetric, GoalPeriod, GoalScope, GoalStatus } from "@prisma/client";

import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import {
  GoalPermissionError,
  assertCanApprove,
  assertCanMutateGoal,
  assertImmutableFieldsUnchanged,
  loadGoalActor,
  resolveGoalStatusOnCreate,
  type GoalActor,
  type GoalDirectory,
} from "@/lib/goals/permissions";
import {
  GOAL_METRICS,
  GOAL_PERIODS,
  GOAL_SCOPES,
  metricNeedsManualLabel,
  periodHasDates,
} from "@/lib/goals/goal-options";

// Goal writes.
//
// TENANT + IDENTITY (architecture rule 8, and the Ace 78.0 Assistant
// write-tool pattern): organizationId and the acting user id are resolved
// from the SERVER SESSION on every call and never accepted from the client.
// A goalId or ownerUserId may arrive from the client, but each is verified
// to belong to the resolved org before anything is written.
//
// PERMISSION FAILURES THROW. Everything in this file routes its permission
// checks through the pure gates in src/lib/goals/permissions.ts, which raise
// GoalPermissionError. That is deliberate and different from ordinary
// validation, which returns { ok: false, error }: a forbidden write means
// the caller reached a path they had no right to, and it should fail loudly
// rather than come back as a friendly inline message.

export type GoalWriteResult = { ok: true; id: string } | { ok: false; error: string };

type Resolved = {
  orgId: string;
  userId: string;
  actor: GoalActor;
  directory: GoalDirectory;
};

async function resolveActor(): Promise<Resolved> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) throw new GoalPermissionError("Not signed in.");

  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    getCurrentOrg(),
  ]);
  if (!user) throw new GoalPermissionError("Signed-in user not found.");

  const loaded = await loadGoalActor(org.id, user.id);
  if (!loaded) {
    // Not a member of the resolved org. Treated as no authority at all
    // rather than falling back to some other lookup.
    throw new GoalPermissionError("You are not a member of this organization.");
  }
  return { orgId: org.id, userId: user.id, actor: loaded.actor, directory: loaded.directory };
}

// Every goal surface lives on /dashboard, so one revalidate covers the tab.
function revalidateGoals(): void {
  revalidatePath("/dashboard");
}

// Parses a YYYY-MM-DD marker into the UTC calendar-date Date the schema
// stores. Deliberately NOT `new Date(str)` on a full ISO string: these are
// calendar markers, and the goals engine re-anchors them to ET at query
// time (see etWindow).
function parseDateMarker(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isMetric(v: string): v is GoalMetric {
  return (GOAL_METRICS as readonly string[]).includes(v);
}
function isPeriod(v: string): v is GoalPeriod {
  return (GOAL_PERIODS as readonly string[]).includes(v);
}
function isScope(v: string): v is GoalScope {
  return (GOAL_SCOPES as readonly string[]).includes(v);
}

// Shared shape validation for create and edit. Returns an error string, or
// null when the input is coherent.
function validateGoalShape(input: {
  metric: GoalMetric;
  period: GoalPeriod;
  targetValue: number;
  manualLabel: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}): string | null {
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0) {
    return "Target must be a positive number.";
  }
  if (metricNeedsManualLabel(input.metric) && !input.manualLabel) {
    return "A manual goal needs a label saying what it counts.";
  }
  if (periodHasDates(input.period)) {
    if (!input.periodStart || !input.periodEnd) {
      return "This period needs a start and an end date.";
    }
    if (input.periodStart > input.periodEnd) {
      return "The start date must be on or before the end date.";
    }
  } else if (input.periodStart || input.periodEnd) {
    // A milestone is cumulative all-time; dates would be meaningless and
    // would make it look like a windowed goal to every reader.
    return "A milestone goal cannot have period dates.";
  }
  return null;
}

export type CreateGoalInput = {
  scope: string;
  // Required when scope is USER. Verified to be a member of the resolved org.
  ownerUserId?: string | null;
  metric: string;
  targetValue: number;
  period: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  parentGoalId?: string | null;
  manualLabel?: string | null;
  notes?: string | null;
  escalationPct?: number | null;
};

export async function createGoal(input: CreateGoalInput): Promise<GoalWriteResult> {
  const { orgId, userId, actor, directory } = await resolveActor();

  if (!isScope(input.scope)) return { ok: false, error: "Unknown goal scope." };
  if (!isMetric(input.metric)) return { ok: false, error: "Unknown metric." };
  if (!isPeriod(input.period)) return { ok: false, error: "Unknown period." };

  const scope = input.scope;
  const metric = input.metric;
  const period = input.period;

  let target: GoalActor | null = null;
  if (scope === GoalScope.USER) {
    const ownerId = input.ownerUserId?.trim();
    if (!ownerId) return { ok: false, error: "Pick whose goal this is." };
    // Membership of the RESOLVED org is what makes this safe: a client
    // cannot name a user outside the tenant.
    target = directory.members.get(ownerId) ?? null;
    if (!target) return { ok: false, error: "That user is not in this organization." };
  }

  const periodStart = periodHasDates(period) ? parseDateMarker(input.periodStart) : null;
  const periodEnd = periodHasDates(period) ? parseDateMarker(input.periodEnd) : null;
  const manualLabel = input.manualLabel?.trim() || null;

  const shapeError = validateGoalShape({
    metric,
    period,
    targetValue: input.targetValue,
    manualLabel,
    periodStart,
    periodEnd,
  });
  if (shapeError) return { ok: false, error: shapeError };

  // THROWS on a forbidden create. Also decides DRAFT/PENDING_APPROVAL/ACTIVE.
  const status = resolveGoalStatusOnCreate({
    organizationId: orgId,
    actor,
    scope,
    target,
    directory,
  });

  // A parent must be a real goal in the same org. Ratio goals never roll up.
  let parentGoalId: string | null = null;
  if (input.parentGoalId) {
    const parent = await prisma.goal.findFirst({
      where: { id: input.parentGoalId, organizationId: orgId },
      select: { id: true },
    });
    if (!parent) return { ok: false, error: "That parent goal was not found." };
    parentGoalId = parent.id;
  }

  try {
    const row = await prisma.goal.create({
      data: {
        organizationId: orgId,
        scope,
        ownerUserId: scope === GoalScope.USER ? target!.id : null,
        metric,
        manualLabel,
        period,
        periodStart,
        periodEnd,
        targetValue: input.targetValue,
        parentGoalId,
        status,
        createdByUserId: userId,
        // An ACTIVE company goal is one the actor approved by creating it,
        // so it carries its approver. A PENDING_APPROVAL one does not.
        approvedByUserId: status === GoalStatus.ACTIVE ? userId : null,
        approvedAt: status === GoalStatus.ACTIVE ? new Date() : null,
        escalationPct:
          period === GoalPeriod.ANNUAL && Number.isFinite(input.escalationPct ?? NaN)
            ? Math.round(input.escalationPct as number)
            : null,
        notes: input.notes?.trim() || null,
      },
      select: { id: true },
    });
    revalidateGoals();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save the goal." };
  }
}

export type UpdateGoalInput = {
  goalId: string;
  targetValue?: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
  manualLabel?: string | null;
  escalationPct?: number | null;
  parentGoalId?: string | null;
  // Accepted only so a stale client sending them is REJECTED loudly rather
  // than having them silently ignored. Never written.
  metric?: string | null;
  period?: string | null;
};

export async function updateGoal(input: UpdateGoalInput): Promise<GoalWriteResult> {
  const { orgId, actor, directory } = await resolveActor();

  const existing = await prisma.goal.findFirst({
    where: { id: input.goalId, organizationId: orgId },
  });
  if (!existing) return { ok: false, error: "Goal not found." };

  // THROWS when the actor may not touch this goal.
  assertCanMutateGoal(orgId, actor, existing, directory);

  // THROWS when the client tries to change metric or period.
  assertImmutableFieldsUnchanged(existing, {
    metric: input.metric && isMetric(input.metric) ? input.metric : null,
    period: input.period && isPeriod(input.period) ? input.period : null,
  });

  const targetValue =
    input.targetValue != null ? input.targetValue : Number(existing.targetValue);
  const periodStart = periodHasDates(existing.period)
    ? (input.periodStart !== undefined ? parseDateMarker(input.periodStart) : existing.periodStart)
    : null;
  const periodEnd = periodHasDates(existing.period)
    ? (input.periodEnd !== undefined ? parseDateMarker(input.periodEnd) : existing.periodEnd)
    : null;
  const manualLabel =
    input.manualLabel !== undefined ? input.manualLabel?.trim() || null : existing.manualLabel;

  const shapeError = validateGoalShape({
    metric: existing.metric,
    period: existing.period,
    targetValue,
    manualLabel,
    periodStart,
    periodEnd,
  });
  if (shapeError) return { ok: false, error: shapeError };

  let parentGoalId = existing.parentGoalId;
  if (input.parentGoalId !== undefined) {
    if (!input.parentGoalId) {
      parentGoalId = null;
    } else {
      if (input.parentGoalId === existing.id) {
        return { ok: false, error: "A goal cannot be its own parent." };
      }
      const parent = await prisma.goal.findFirst({
        where: { id: input.parentGoalId, organizationId: orgId },
        select: { id: true },
      });
      if (!parent) return { ok: false, error: "That parent goal was not found." };
      parentGoalId = parent.id;
    }
  }

  try {
    await prisma.goal.update({
      where: { id: existing.id },
      data: {
        targetValue,
        periodStart,
        periodEnd,
        manualLabel,
        parentGoalId,
        notes: input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
        escalationPct:
          input.escalationPct !== undefined && existing.period === GoalPeriod.ANNUAL
            ? (Number.isFinite(input.escalationPct ?? NaN)
                ? Math.round(input.escalationPct as number)
                : null)
            : existing.escalationPct,
      },
    });
    revalidateGoals();
    return { ok: true, id: existing.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to update the goal." };
  }
}

// ARCHIVED, never deleted. An archived goal drops off the tab but stays
// queryable, so a past quarter's target and everything measured against it
// remain readable after the fact.
export async function archiveGoal(goalId: string): Promise<GoalWriteResult> {
  const { orgId, actor, directory } = await resolveActor();

  const existing = await prisma.goal.findFirst({
    where: { id: goalId, organizationId: orgId },
    select: { id: true, scope: true, ownerUserId: true },
  });
  if (!existing) return { ok: false, error: "Goal not found." };

  assertCanMutateGoal(orgId, actor, existing, directory);

  try {
    await prisma.goal.update({
      where: { id: existing.id },
      data: { status: GoalStatus.ARCHIVED },
    });
    revalidateGoals();
    return { ok: true, id: existing.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to archive the goal." };
  }
}

export async function approveCompanyGoal(goalId: string): Promise<GoalWriteResult> {
  const { orgId, userId, actor } = await resolveActor();
  // THROWS unless the actor is the owner (goalLevel 0).
  assertCanApprove(orgId, actor);

  const existing = await prisma.goal.findFirst({
    where: { id: goalId, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: "Goal not found." };
  if (existing.status !== GoalStatus.PENDING_APPROVAL) {
    return { ok: false, error: "That goal is not waiting for approval." };
  }

  try {
    await prisma.goal.update({
      where: { id: existing.id },
      data: {
        status: GoalStatus.ACTIVE,
        approvedByUserId: userId,
        approvedAt: new Date(),
        declinedReason: null,
      },
    });
    revalidateGoals();
    return { ok: true, id: existing.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to approve the goal." };
  }
}

// Declining ARCHIVES with a reason rather than deleting, so the request and
// why it was turned down both survive.
export async function declineCompanyGoal(
  goalId: string,
  reason: string,
): Promise<GoalWriteResult> {
  const { orgId, actor } = await resolveActor();
  assertCanApprove(orgId, actor);

  const trimmed = reason?.trim() ?? "";
  if (!trimmed) return { ok: false, error: "A reason is required to decline." };

  const existing = await prisma.goal.findFirst({
    where: { id: goalId, organizationId: orgId },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, error: "Goal not found." };
  if (existing.status !== GoalStatus.PENDING_APPROVAL) {
    return { ok: false, error: "That goal is not waiting for approval." };
  }

  try {
    await prisma.goal.update({
      where: { id: existing.id },
      data: { status: GoalStatus.ARCHIVED, declinedReason: trimmed },
    });
    revalidateGoals();
    return { ok: true, id: existing.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to decline the goal." };
  }
}

export type AddManualActualInput = {
  goalId: string;
  value: number;
  // YYYY-MM-DD. The day the value is attributed to, which is NOT
  // necessarily today - Monday's calls logged on Tuesday belong to Monday.
  entryDate: string;
  note?: string | null;
};

export async function addManualActual(input: AddManualActualInput): Promise<GoalWriteResult> {
  const { orgId, userId, actor, directory } = await resolveActor();

  const goal = await prisma.goal.findFirst({
    where: { id: input.goalId, organizationId: orgId },
    select: { id: true, scope: true, ownerUserId: true, metric: true },
  });
  if (!goal) return { ok: false, error: "Goal not found." };

  assertCanMutateGoal(orgId, actor, goal, directory);

  if (goal.metric !== GoalMetric.MANUAL) {
    // Every other metric computes its actual live from the canonical
    // tables. Writing entries against one would create a second source of
    // truth that nothing reads.
    return { ok: false, error: "Only a manual goal takes hand-entered actuals." };
  }
  if (!Number.isFinite(input.value)) {
    return { ok: false, error: "Value must be a number." };
  }
  const entryDate = parseDateMarker(input.entryDate);
  if (!entryDate) return { ok: false, error: "Pick a valid date for this entry." };

  try {
    const row = await prisma.goalActualEntry.create({
      data: {
        organizationId: orgId,
        goalId: goal.id,
        value: input.value,
        entryDate,
        enteredByUserId: userId,
        note: input.note?.trim() || null,
      },
      select: { id: true },
    });
    revalidateGoals();
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to add the entry." };
  }
}
