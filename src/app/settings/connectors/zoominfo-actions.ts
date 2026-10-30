"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { clearZoomInfoTokenCache } from "@/lib/zoominfo";

export async function saveZoomInfoCredentials(input: {
  username: string;
  password: string;
}): Promise<void> {
  const username = input.username.trim();
  const password = input.password;
  if (!username) throw new Error("API username is empty.");
  if (!password) throw new Error("API password is empty.");
  const org = await getCurrentOrg();
  await prisma.organization.update({
    where: { id: org.id },
    data: { zoomInfoUsername: username, zoomInfoPassword: password },
  });
  clearZoomInfoTokenCache(org.id);
  revalidatePath("/settings/connectors");
}

export async function disconnectZoomInfo(): Promise<void> {
  const org = await getCurrentOrg();
  await prisma.organization.update({
    where: { id: org.id },
    data: { zoomInfoUsername: null, zoomInfoPassword: null },
  });
  clearZoomInfoTokenCache(org.id);
  revalidatePath("/settings/connectors");
}
