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
  extraUnreadMailThreadIds,
}: {
  userId: string;
  organizationId: string;
  closeTags?: string[];
  // Thread ids a caller just confirmed are INBOX+UNREAD (e.g. the Gmail
  // webhook on a fresh arrival), folded into the count so the badge
  // reflects the new message even before Gmail's is:unread index catches up.
  extraUnreadMailThreadIds?: string[];
}): Promise<void> {
  try {
    const counts = await getUnreadCountsForOrg(organizationId, {
      extraUnreadMailThreadIds,
    });
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
  extraUnreadMailThreadIds,
}: {
  organizationId: string;
  closeTags?: string[];
  extraUnreadMailThreadIds?: string[];
}): Promise<void> {
  try {
    const counts = await getUnreadCountsForOrg(organizationId, {
      extraUnreadMailThreadIds,
    });
    await sendPushToOrg(organizationId, badgeSyncPayload(counts, closeTags));
  } catch (err) {
    console.error("[badge-sync] sendBadgeSyncToOrg failed", err);
  }
}
