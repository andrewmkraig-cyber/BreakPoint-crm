import type { BdOrgConfig } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Thin facade over BdOrgConfig scoped to the two fields the BD engine
// pipeline reads (cron + webhook). The full settings page in
// /settings/bd still goes through updateBdOrgConfig in
// src/app/settings/bd/actions.ts — these helpers are for runtime gates
// that just need the master switch and the cap.
export type BDSettings = BdOrgConfig;

export async function getBDSettings(orgId: string): Promise<BDSettings> {
  return prisma.bdOrgConfig.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId },
    update: {},
  });
}

export async function updateBDSettings(
  orgId: string,
  data: Partial<Pick<BDSettings, "engineActive" | "globalDailyCap">>,
): Promise<BDSettings> {
  return prisma.bdOrgConfig.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, ...data },
    update: data,
  });
}
