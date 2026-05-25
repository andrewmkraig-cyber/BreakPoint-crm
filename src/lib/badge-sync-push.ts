import { badgePayloadFields } from "@/lib/badge-math";
import { getUnreadCountsForOrg } from "@/lib/unread-counts";
import { sendPushToOrg, sendPushToUser, type PushPayload } from "@/lib/web-push";

function badgeSyncPayload(
  counts: Awaited<ReturnType<typeof getUnreadCountsForOrg>>,
  closeTags?: string[],
): PushPayload {
  return {
    type: "badge-sync",
    title: "Ace badge sync",
    body: "Unread count updated",
    tag: "badge-sync",
    closeTags,
    ...badgePayloadFields(counts),
  };
}

export async function sendBadgeSyncToUser({
  userId,
  organizationId,
  closeTags,
}: {
  userId: string;
  organizationId: string;
  closeTags?: string[];
}): Promise<void> {
  try {
    const counts = await getUnreadCountsForOrg(organizationId);
    await sendPushToUser(
      userId,
      organizationId,
      badgeSyncPayload(counts, closeTags),
    );
  } catch (err) {
    console.error("[badge-sync] sendBadgeSyncToUser failed", err);
  }
}

export async function sendBadgeSyncToOrg({
  organizationId,
  closeTags,
}: {
  organizationId: string;
  closeTags?: string[];
}): Promise<void> {
  try {
    const counts = await getUnreadCountsForOrg(organizationId);
    await sendPushToOrg(organizationId, badgeSyncPayload(counts, closeTags));
  } catch (err) {
    console.error("[badge-sync] sendBadgeSyncToOrg failed", err);
  }
}
