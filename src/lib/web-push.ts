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
  // App-icon badge fields. sw.js reads `badgeCount` directly and calls
  // setAppBadge(N). mailUnread / phoneUnread ride along for debugging
  // and let the SW reason about which surface stacked (Mail or Phone)
  // without having to query Ace itself. All three are optional — when
  // omitted the SW falls back to the generic dot rather than clearing.
  mailUnread?: number | null;
  phoneUnread?: number | null;
  badgeCount?: number | null;
};

// TEMP DIAG (keep until production push delivery is confirmed — see
// project_web_push_temp_diag): mask any run of 5+ digits so an
// unknown-number tag (`sms-<10 digits>`) or a number-fallback title
// ("New text from +1...") can't leak a full phone number into logs.
// cuid-based tags (`sms-<candidateId>`) pass through untouched.
function redactDigits(s: string): string {
  return s.replace(/\d{5,}/g, (m) => `***${m.slice(-2)}`);
}

// TEMP DIAG: payload shape WITHOUT body / number / token. badgeCount is
// reported as present-or-omitted so we can prove notification delivery
// stays independent of badge reliability (an omitted badge must NOT
// stop the notification from sending).
function diagPayload(payload: PushPayload) {
  return {
    title: redactDigits(payload.title),
    tag: payload.tag ? redactDigits(payload.tag) : "(none)",
    badgeCountPresent: typeof payload.badgeCount === "number",
    badgeCount: typeof payload.badgeCount === "number" ? payload.badgeCount : null,
  };
}

type DispatchResult = { total: number; sent: number; pruned: number; failed: number };

// Push is best-effort. Any error here must NOT bubble up — webhook
// handlers + server actions call sendPush after the row write that
// actually matters has already committed.
async function dispatch(
  subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload,
  fn: string,
): Promise<DispatchResult> {
  const result: DispatchResult = { total: subs.length, sent: 0, pruned: 0, failed: 0 };
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
          // TEMP DIAG: log the pruned endpoint PREFIX only (never the
          // full endpoint / token) so a silent device drop is visible.
          console.log("[web-push][diag] pruned dead subscription", {
            fn,
            status,
            endpointPrefix: sub.endpoint.slice(0, 40),
          });
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
  // TEMP DIAG: per-call send outcome. `sent` is the success status the
  // task asks for; a Quo text with the PWA closed should show sent>0.
  console.log("[web-push][diag] dispatch result", { fn, ...result });
  return result;
}

export async function sendPushToUser(
  userId: string,
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const vapidOk = ensureVapid();
    if (!vapidOk) {
      console.log("[web-push][diag] VAPID not configured, push skipped", {
        fn: "sendPushToUser",
        vapidConfigured: false,
      });
      return;
    }
    const subs = await prisma.pushSubscription.findMany({
      where: { userId, organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    console.log("[web-push][diag] sendPushToUser", {
      vapidConfigured: true,
      subscriptionCount: subs.length,
      ...diagPayload(payload),
    });
    await dispatch(subs, payload, "sendPushToUser");
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
    const vapidOk = ensureVapid();
    if (!vapidOk) {
      console.log("[web-push][diag] VAPID not configured, push skipped", {
        fn: "sendPushToOrg",
        vapidConfigured: false,
      });
      return;
    }
    const subs = await prisma.pushSubscription.findMany({
      where: { organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    console.log("[web-push][diag] sendPushToOrg", {
      vapidConfigured: true,
      subscriptionCount: subs.length,
      ...diagPayload(payload),
    });
    await dispatch(subs, payload, "sendPushToOrg");
  } catch (err) {
    console.error("[web-push] sendPushToOrg swallowed error", err);
  }
}

// Route to a known owner FIRST, fall back to the org SECOND — without
// duplicate sends. Quo's per-user routing pins a known-candidate push
// to Candidate.createdById; when that owner has zero live devices (an
// imported/migrated candidate owned by another user, a recruiter who
// never enabled push on this phone), sendPushToUser dispatched to an
// empty list and the notification silently vanished even though the
// SMS/call row persisted fine. The org fallback ensures a push that
// has somewhere to land never disappears. Fallback fires ONLY when the
// owner has no subscriptions, so org devices are never double-pushed.
export async function sendPushToUserOrOrg(
  userId: string,
  organizationId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const vapidOk = ensureVapid();
    if (!vapidOk) {
      console.log("[web-push][diag] VAPID not configured, push skipped", {
        fn: "sendPushToUserOrOrg",
        vapidConfigured: false,
      });
      return;
    }
    const userSubs = await prisma.pushSubscription.findMany({
      where: { userId, organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    console.log("[web-push][diag] sendPushToUserOrOrg:user", {
      vapidConfigured: true,
      userId,
      subscriptionCount: userSubs.length,
      ...diagPayload(payload),
    });
    if (userSubs.length > 0) {
      await dispatch(userSubs, payload, "sendPushToUserOrOrg:user");
      return;
    }
    // Owner has no live device — fan out to the org so the push still
    // lands (in practice, Andrew's iPhone). No duplicate: we only get
    // here when the user-scoped list was empty.
    const orgSubs = await prisma.pushSubscription.findMany({
      where: { organizationId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    console.log("[web-push][diag] sendPushToUserOrOrg:org-fallback", {
      reason: "user had 0 subscriptions",
      subscriptionCount: orgSubs.length,
      ...diagPayload(payload),
    });
    await dispatch(orgSubs, payload, "sendPushToUserOrOrg:org-fallback");
  } catch (err) {
    console.error("[web-push] sendPushToUserOrOrg swallowed error", err);
  }
}
