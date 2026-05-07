"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

// Server actions for the Claude History tab. Conversations bucket by
// conversationId; legacy NULL rows fall back to a per-day bucket
// keyed "legacy-YYYY-MM-DD". Delete by either shape.
//
// Auth posture mirrors the panel routes: a hard 401 when there's no
// signed-in recruiter so a leaked URL can't wipe history.

export type DeleteConversationInput = {
  conversationKey: string;
};

export async function deleteConversationAction(
  input: DeleteConversationInput,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { ok: false, error: "Sign in required" };
  }
  const key = input.conversationKey;
  if (!key) return { ok: false, error: "Missing conversation key" };

  const org = await getCurrentOrg();

  // Legacy bucket: "legacy-YYYY-MM-DD" → delete NULL-conversationId
  // rows from that calendar day.
  const legacyMatch = /^legacy-(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (legacyMatch) {
    const date = legacyMatch[1];
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    await prisma.claudePanelMessage.deleteMany({
      where: {
        organizationId: org.id,
        conversationId: null,
        createdAt: { gte: start, lt: end },
      },
    });
  } else {
    await prisma.claudePanelMessage.deleteMany({
      where: { organizationId: org.id, conversationId: key },
    });
  }

  revalidatePath("/settings/history");
  revalidatePath(`/settings/history/${key}`);
  return { ok: true };
}
