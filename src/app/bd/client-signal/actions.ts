"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

type Result = { ok: true } | { ok: false; error: string };

export async function markSignalActed(signalId: string): Promise<Result> {
  try {
    const org = await getCurrentOrg();
    const result = await prisma.clientSignal.updateMany({
      where: { id: signalId, organizationId: org.id },
      data: { status: "ACTED", actedAt: new Date(), dismissedAt: null },
    });
    if (result.count === 0) return { ok: false, error: "Signal not found." };
    revalidatePath("/bd/client-signal");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't mark signal." };
  }
}

export async function markSignalDismissed(signalId: string): Promise<Result> {
  try {
    const org = await getCurrentOrg();
    const result = await prisma.clientSignal.updateMany({
      where: { id: signalId, organizationId: org.id },
      data: { status: "DISMISSED", dismissedAt: new Date(), actedAt: null },
    });
    if (result.count === 0) return { ok: false, error: "Signal not found." };
    revalidatePath("/bd/client-signal");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't dismiss signal." };
  }
}
