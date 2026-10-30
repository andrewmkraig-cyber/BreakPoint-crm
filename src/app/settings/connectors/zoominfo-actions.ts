"use server";

import { revalidatePath } from "next/cache";

import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { clearZoomInfoTokenCache, normalizePem } from "@/lib/zoominfo";

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
    data: {
      zoomInfoUsername: username,
      zoomInfoPassword: password,
      zoomInfoClientId: null,
      zoomInfoPrivateKey: null,
    },
  });
  clearZoomInfoTokenCache(org.id);
  revalidatePath("/settings/connectors");
}

export async function saveZoomInfoPki(input: {
  username: string;
  clientId: string;
  privateKey: string;
}): Promise<void> {
  const username = input.username.trim();
  const clientId = input.clientId.trim();
  const privateKey = normalizePem(input.privateKey);
  if (!username) throw new Error("Username (your ZoomInfo login email) is empty.");
  if (!clientId) throw new Error("Client ID is empty.");
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    throw new Error("That does not look like a private key. Paste the whole key file, including the BEGIN and END lines.");
  }
  const org = await getCurrentOrg();
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      zoomInfoUsername: username,
      zoomInfoClientId: clientId,
      zoomInfoPrivateKey: privateKey,
      // PKI replaces any password that was stored before.
      zoomInfoPassword: null,
    },
  });
  clearZoomInfoTokenCache(org.id);
  revalidatePath("/settings/connectors");
}

export async function disconnectZoomInfo(): Promise<void> {
  const org = await getCurrentOrg();
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      zoomInfoUsername: null,
      zoomInfoPassword: null,
      zoomInfoClientId: null,
      zoomInfoPrivateKey: null,
    },
  });
  clearZoomInfoTokenCache(org.id);
  revalidatePath("/settings/connectors");
}
