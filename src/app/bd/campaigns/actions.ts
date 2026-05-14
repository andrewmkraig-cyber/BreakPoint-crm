"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Archives a BDRun by flipping its status to DISMISSED. Active Campaigns
// filters DISMISSED out, so an archived run disappears from /bd/campaigns
// on next render. The Activity feed still surfaces history because it
// reads BDActivity rows, not BDRun.status.
export async function archiveBDRun(runId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const org = await getCurrentOrg();
  if (!runId || typeof runId !== "string") {
    return { ok: false, error: "Invalid run id." };
  }

  const result = await prisma.bDRun.updateMany({
    where: { id: runId, organizationId: org.id },
    data: { status: "DISMISSED" },
  });
  if (result.count === 0) {
    return { ok: false, error: "Run not found." };
  }

  revalidatePath("/bd/campaigns");
  revalidatePath("/bd/activity");
  return { ok: true };
}
