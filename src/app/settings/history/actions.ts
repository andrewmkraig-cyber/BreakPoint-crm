"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Server actions for the Claude History tab. Conversations bucket by
// calendar day per org, so deleting a "conversation" means deleting
// every ClaudePanelMessage row from that org with createdAt in the
// [day, day+1) window.
//
// Auth posture mirrors the panel routes: a hard 401 when there's no
// signed-in recruiter so a leaked URL can't wipe history.

export type DeleteConversationInput = {
  date: string; // YYYY-MM-DD
};

export async function deleteConversationAction(
  input: DeleteConversationInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { ok: false, error: "Sign in required" };
  }
  const date = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid date" };
  }
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const org = await getCurrentOrg();
  await prisma.claudePanelMessage.deleteMany({
    where: {
      organizationId: org.id,
      createdAt: { gte: start, lt: end },
    },
  });
  revalidatePath("/settings/history");
  revalidatePath(`/settings/history/${date}`);
  return { ok: true };
}
