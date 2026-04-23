import type { Prisma } from "@prisma/client";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Wrapper that stamps organizationId on every ActionLog row so the tenant
// scoping stays consistent without every caller having to remember. Pass
// the same shape you would to prisma.actionLog.create({ data: ... }) minus
// the organizationId (it's filled in here). Callers that want a bare
// prisma.actionLog.create still work, but new sites should use this.
export async function createActionLog(
  data: Omit<Prisma.ActionLogUncheckedCreateInput, "organizationId">,
): Promise<void> {
  const org = await getCurrentOrg();
  await prisma.actionLog.create({ data: { ...data, organizationId: org.id } });
}
