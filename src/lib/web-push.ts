import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// Web push sender. Configured lazily — touching this module without
// VAPID env vars set (e.g. in a CI environment or pre-key generation)
// doesn't throw; sendPush* just becomes a no-op so calling code never
// has to guard around it.

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    // Browser push services require a contact mailto/url to register the
    // sender. Using the BreakPoint Talent inbox keeps abuse complaints
    // routable rather than ending up in the void.
    "mailto:andrew@breakpointtalent.com",
    publicKey,
    privateKey,
  );
  vapidConfigured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  // Only "notification" remains. The silent "badge-sync" type was removed:
  // iOS revokes the PushSubscription for pushes that show no notification,
  // which killed background delivery. Every push is now user-visible.
  type?: "notification";
  url?: string;
  // Tag dedupes notifications — subsequent pushes with the same tag
  // replace the previous notification rather than stacking. Pass a
  // stable thread / call id (e.g. `sms-<candidateId>`).
  tag?: string;
  // App-icon badge fields. sw.js reads `badgeCount` directly and calls
  // setAppBadge(N). mailUnread / phoneUnread ride along for debugging
  // and let the SW reason about which surface stacked (Mail or Phone)
  // without having to query Ace itself. All three are optional — when
  // omitted the SW falls back to the generic dot rather than clearing.
  mailUnread?: number | null;
  phoneUnread?: number | null;
  badgeCount?: number | null;
  // Badge-sync pushes can ask the service worker to close stale visible
  // notifications for messages now read on another device.
  closeTags?: string[];
  // Manual diagnostics should surface even when Ace is focused; normal
  // live notifications still suppress the OS banner while an Ace window
  // is focused to avoid duplicates with the in-app toast.
  forceNotify?: boolean;
};

export type PushDispatchResult = {
  total: number;
  sent: number;
  pruned: number;
  failed: number;
};

const EMPTY_DISPATCH_RESULT: PushDispatchResult = {
  total: 0,
  sent: 0,
  pruned: 0,
  failed: 0,
};

// Push is best-effort. Any error here must NOT bubble up — webhook
// handlers + server actions call sendPush after the row write that
// actually matters has already committed.
async function dispatch(
  subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
  fn: string,
): Promise<PushDispatchResult> {
  const result: PushDispatchResult = { total: subs.length, sent: 0, pruned: 0, failed: 0 };
  if (subs.length === 0) return result;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        result.sent++;
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        // 404 + 410 from the push service mean the endpoint is dead
        // (uninstalled PWA, user revoked, browser cleared state).
        // Purge so we don't keep hammering it on every trigger.
        if (status === 404 || status === 410) {
          result.pruned++;
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        } else {
          result.failed++;
          console.error("[web-push] send failed", {
            fn,
            status,
            endpointPrefix: sub.endpoint.slice(0, 40),
          });
        }
      }
    }),
  );
  return result;
}

export async function sendPushToUser(
  userId: string,
  organizationId: string,
  payload: PushPayload,
): Promise<PushDispatchResult> {
  try {
    if (!ensureVapid()) return EMPTY_DISPATCH_RESULT;
    const subs = await prisma.pushSubscription.findMany({
      where: { userId, organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    return await dispatch(subs, payload, "sendPushToUser");
  } catch (err) {
    console.error("[web-push] sendPushToUser swallowed error", err);
    return EMPTY_DISPATCH_RESULT;
  }
}

// Org-wide broadcasts are only for genuinely shared events. Personal
// surfaces like Gmail or Quo should use sendPushToUser so one recruiter's
// account never becomes another recruiter's fallback device.
export async function sendPushToOrg(
  organizationId: string,
  payload: PushPayload,
): Promise<PushDispatchResult> {
  try {
    if (!ensureVapid()) return EMPTY_DISPATCH_RESULT;
    const subs = await prisma.pushSubscription.findMany({
      where: { organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    return await dispatch(subs, payload, "sendPushToOrg");
  } catch (err) {
    console.error("[web-push] sendPushToOrg swallowed error", err);
    return EMPTY_DISPATCH_RESULT;
  }
}
