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
  url?: string;
  // Tag dedupes notifications — subsequent pushes with the same tag
  // replace the previous notification rather than stacking. Pass a
  // stable thread / call id (e.g. `sms-<candidateId>`).
  tag?: string;
};

// Push is best-effort. Any error here must NOT bubble up — webhook
// handlers + server actions call sendPush after the row write that
// actually matters has already committed.
async function dispatch(
  subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
): Promise<void> {
  if (subs.length === 0) return;
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
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        // 404 + 410 from the push service mean the endpoint is dead
        // (uninstalled PWA, user revoked, browser cleared state).
        // Purge so we don't keep hammering it on every trigger.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        } else {
          console.error("[web-push] send failed", {
            status,
            endpoint: sub.endpoint.slice(0, 60),
          });
        }
      }
    }),
  );
}

export async function sendPushToUser(
  userId: string,
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    if (!ensureVapid()) return;
    const subs = await prisma.pushSubscription.findMany({
      where: { userId, organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    await dispatch(subs, payload);
  } catch (err) {
    console.error("[web-push] sendPushToUser swallowed error", err);
  }
}

// Webhook callers (no session) don't know which user to ping —
// resolve by orgId and fan out to every subscribed device in the org.
// Ace is single-tenant per the comment in defaultOrgId, so in practice
// this targets Andrew's devices.
export async function sendPushToOrg(
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    if (!ensureVapid()) return;
    const subs = await prisma.pushSubscription.findMany({
      where: { organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    await dispatch(subs, payload);
  } catch (err) {
    console.error("[web-push] sendPushToOrg swallowed error", err);
  }
}
