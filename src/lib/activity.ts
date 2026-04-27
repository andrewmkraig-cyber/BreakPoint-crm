import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Phase 4c: canonical activity-log writer. Every tenant-scoped user
// action lands here with a standard shape so Dashboard rollups and
// per-entity activity feeds all read from one table.
//
// Design rules:
// - Caller passes organizationId explicitly. The helper does not call
//   getCurrentOrg — that decouples it from the session layer so cron
//   jobs, scripts, and tests can log activities with any orgId.
// - All six non-metadata fields are required. A missing organizationId
//   or userId silently dropping the row would be worse than throwing
//   at the boundary, so we validate up front.
// - DB failures never rethrow. Instrumentation that breaks the user
//   action it's trying to observe is a foot-gun; log to console.error
//   and swallow. The user's action completed — losing the audit row is
//   recoverable; breaking the action is not.
//
// Action types fired today: see docs/operations/activity-log.md for
// the complete wire-map. call_logged is deferred — the real call
// audit table is CallLog (written by the Krispcall/Quo webhook at
// src/app/api/quo/webhook/route.ts). Wire logActivity into
// that webhook when the activity panel surfaces call rows.

export type LogActivityInput = {
  organizationId: string;
  userId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonValue;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
  if (!input.organizationId) {
    // eslint-disable-next-line no-console
    console.error("[logActivity] missing organizationId — dropping row", {
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
    });
    return;
  }
  if (!input.userId) {
    // eslint-disable-next-line no-console
    console.error("[logActivity] missing userId — dropping row", {
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
    });
    return;
  }
  if (!input.actionType || !input.targetType || !input.targetId) {
    // eslint-disable-next-line no-console
    console.error("[logActivity] missing required field — dropping row", input);
    return;
  }

  try {
    await prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (e) {
    // Never rethrow — callers invoke this inside the hot path of the
    // action they're instrumenting. A failed audit write must not take
    // the user's action down with it.
    // eslint-disable-next-line no-console
    console.error("[logActivity] write failed", {
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
