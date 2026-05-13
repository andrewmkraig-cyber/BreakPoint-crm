"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export async function saveMercuryApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error("API key is empty.");
  }
  const org = await getCurrentOrg();
  await prisma.organization.update({
    where: { id: org.id },
    data: { mercuryApiKey: trimmed },
  });
  revalidatePath("/settings/connectors");
}

export async function disconnectMercury(): Promise<void> {
  const org = await getCurrentOrg();
  await prisma.organization.update({
    where: { id: org.id },
    data: { mercuryApiKey: null },
  });
  revalidatePath("/settings/connectors");
}
