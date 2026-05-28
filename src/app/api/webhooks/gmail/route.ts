import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractEmailsFromHeader,
  getFreshAccessToken,
  tagThreadByAddresses,
} from "@/lib/gmail";
import { sendBadgeSyncToUser } from "@/lib/badge-sync-push";
import { badgePayloadFields } from "@/lib/badge-math";
import { getUnreadCountsForOrg } from "@/lib/unread-counts";
import { sendPushToUser, type PushPayload } from "@/lib/web-push";

export const dynamic = "force-dynamic";

// Gmail Pub/Sub push receiver. Google posts to this URL every time
// the watched mailbox (INBOX) changes. We respond 200 on every code
// path — Pub/Sub treats anything else as failure and retries
// aggressively, which would melt the route during transient errors.
// App-open and the daily renew cron register/refresh the watch; this
// route is the consumer side that turns Gmail notices into Ace pushes.
//
// Auth is a shared-secret query param (?secret=...) rather than
// OIDC. Andrew controls both the GCP push subscription URL and the
// Vercel env, so the secret stays out of any commit and never
// crosses the public internet in a form Google logs.

type PubSubEnvelope = {
  message?: {
    data?: string; // base64
    messageId?: string;
    publishTime?: string;
  };
};

type GmailNotice = {
  emailAddress: string;
  historyId: string;
};

type GmailHistoryEntry = {
  messagesAdded?: Array<{
    message?: {
      id: string;
      threadId: string;
    };
  }>;
};

type GmailHistoryResponse = {
  history?: GmailHistoryEntry[];
  historyId?: string;
};

type GmailHeader = { name?: string; value?: string };

type NewUnreadInboxThread = {
  threadId: string;
  title: string;
  body: string;
};

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  const hit = headers.find((h) => (h.name ?? "").toLowerCase() === lower);
  return hit?.value ?? "";
}

function displaySender(fromHeader: string, addresses: string[]): string {
  const beforeAngle = fromHeader.split("<")[0]?.trim();
  const cleaned = beforeAngle?.replace(/^"+|"+$/g, "").trim();
  return cleaned || addresses[0] || "New mail";
}

async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
): Promise<{
  addresses: string[];
  labelIds: string[];
  from: string;
  subject: string;
}> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
  );
  url.searchParams.set("format", "metadata");
  for (const h of ["From", "To", "Cc", "Subject"]) {
    url.searchParams.append("metadataHeaders", h);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return { addresses: [], labelIds: [], from: "", subject: "" };
  const j = (await res.json()) as {
    labelIds?: string[];
    payload?: { headers?: GmailHeader[] };
  };
  const headers = j.payload?.headers;
  const from = headerValue(headers, "From");
  return {
    addresses: [
      ...extractEmailsFromHeader(from),
      ...extractEmailsFromHeader(headerValue(headers, "To")),
      ...extractEmailsFromHeader(headerValue(headers, "Cc")),
    ],
    labelIds: j.labelIds ?? [],
    from,
    subject: headerValue(headers, "Subject"),
  };
}

async function sendNewMailPushes({
  userId,
  organizationId,
  threads,
}: {
  userId: string;
  organizationId: string;
  threads: NewUnreadInboxThread[];
}) {
  if (threads.length === 0) return;

  const counts = await getUnreadCountsForOrg(organizationId, {
    extraUnreadMailThreadIds: threads.map((t) => t.threadId),
  });

  console.log("[push][badge-diag]", {
    source: "gmail-webhook-visible",
    newThreads: threads.length,
    mailUnread: counts.mailUnread,
    phoneUnread: counts.phoneUnread,
    badgeCount: counts.badgeCount,
    mailReliable: counts.mailReliable,
    mailReason: counts.mailReason,
    mailSource: counts.mailSource,
    badgeOmitted: counts.badgeCount === null,
  });

  const badgeFields = badgePayloadFields(counts);
  await Promise.all(
    threads.map((thread) => {
      const payload: PushPayload = {
        title: thread.title,
        body: thread.body,
        url: `/mail?thread=${encodeURIComponent(thread.threadId)}`,
        tag: `mail-${thread.threadId}`,
        ...badgeFields,
      };
      return sendPushToUser(userId, organizationId, payload);
    }),
  );
}

export async function POST(req: NextRequest) {
  const expected = process.env.GMAIL_PUSH_SECRET;
  const provided = req.nextUrl.searchParams.get("secret");
  if (!expected || provided !== expected) {
    console.warn("[gmail webhook] rejected: bad or missing secret");
    return NextResponse.json({ ok: true });
  }

  let envelope: PubSubEnvelope;
  try {
    envelope = (await req.json()) as PubSubEnvelope;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const dataB64 = envelope.message?.data;
  if (!dataB64) return NextResponse.json({ ok: true });

  let notice: GmailNotice;
  try {
    const decoded = Buffer.from(dataB64, "base64").toString("utf8");
    notice = JSON.parse(decoded) as GmailNotice;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const email = (notice.emailAddress ?? "").toLowerCase().trim();
  const newHistoryId = String(notice.historyId ?? "");
  if (!email || !newHistoryId) return NextResponse.json({ ok: true });

  try {
    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ ok: true });

    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    if (!membership) return NextResponse.json({ ok: true });
    const organizationId = membership.organizationId;

    const watch = await prisma.gmailPushWatch.findUnique({
      where: { organizationId_email: { organizationId, email } },
      select: { lastHistoryId: true },
    });
    if (!watch) return NextResponse.json({ ok: true });

    const accessToken = await getFreshAccessToken(user.id);

    const histUrl = new URL(
      "https://gmail.googleapis.com/gmail/v1/users/me/history",
    );
    histUrl.searchParams.set("startHistoryId", watch.lastHistoryId);
    histUrl.searchParams.append("historyTypes", "messageAdded");
    const histRes = await fetch(histUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    let addedCount = 0;
    // Threads we confirmed are INBOX + UNREAD in this batch. Folded into
    // the badge count below so the closed-app badge reflects the email
    // that just arrived even before Gmail's is:unread search index does.
    const newUnreadInboxThreads = new Map<string, NewUnreadInboxThread>();
    if (histRes.ok) {
      const histJson = (await histRes.json()) as GmailHistoryResponse;
      const entries = histJson.history ?? [];
      const seenThreads = new Set<string>();

      for (const entry of entries) {
        for (const msgAdded of entry.messagesAdded ?? []) {
          const m = msgAdded.message;
          if (!m?.id || !m.threadId) continue;
          if (seenThreads.has(m.threadId)) continue;
          seenThreads.add(m.threadId);

          const meta = await fetchMessageMeta(accessToken, m.id);
          if (!meta.addresses.length) continue;

          try {
            await tagThreadByAddresses({
              threadId: m.threadId,
              addresses: meta.addresses,
              organizationId,
            });
            addedCount += 1;
          } catch (err) {
            console.error("[gmail webhook] tag failed", {
              threadId: m.threadId,
              err: err instanceof Error ? err.message : String(err),
            });
          }

          // The watch is INBOX-scoped but history.list isn't, so a
          // concurrent Sent message could ride along. Gate on the real
          // labels so the badge floor only counts genuine unread inbox
          // arrivals and never inflates.
          if (
            meta.labelIds.includes("INBOX") &&
            meta.labelIds.includes("UNREAD")
          ) {
            newUnreadInboxThreads.set(m.threadId, {
              threadId: m.threadId,
              title: displaySender(meta.from, meta.addresses),
              body: meta.subject || "(no subject)",
            });
          }
        }
      }
    } else {
      console.error("[gmail webhook] history.list failed", {
        status: histRes.status,
      });
    }

    await prisma.gmailPushWatch.update({
      where: { organizationId_email: { organizationId, email } },
      data: { lastHistoryId: newHistoryId },
    });

    console.log("[gmail webhook] processed", {
      email,
      newThreadsTagged: addedCount,
      newUnreadInbox: newUnreadInboxThreads.size,
    });

    // Closed-app visible mail notifications must be emitted here, in the
    // server-side Gmail webhook. The React MailProvider only exists after
    // Ace is opened, so relying on its poller made morning notifications
    // appear only after the user tapped into the PWA.
    await sendNewMailPushes({
      userId: user.id,
      organizationId,
      threads: Array.from(newUnreadInboxThreads.values()),
    });

    // Reconcile the badge after EVERY Pub/Sub notice, not just on new mail.
    // Gmail pings us on any INBOX change - new arrivals AND reads / label
    // changes done in native Gmail - so recomputing the live unread count
    // here is what lets the closed mobile PWA badge drop when a message is
    // read outside Ace. (Desktop Ace already covered this by polling while
    // open; the closed PWA had no way to know - this is that gap.)
    //
    // SILENT by design: this sends a `badge-sync` push, which sw.js never
    // renders as a banner (it short-circuits showNotification on
    // type === "badge-sync"). So this path produces ZERO visible
    // notifications and cannot duplicate a new-mail alert. Targeted to the
    // mailbox owner resolved above, not broadcast to the whole org.
    await sendBadgeSyncToUser({
      userId: user.id,
      organizationId,
      // Floor the count with threads confirmed INBOX+UNREAD this batch -
      // Gmail's is:unread index lags a few seconds behind a fresh arrival.
      extraUnreadMailThreadIds: Array.from(newUnreadInboxThreads.keys()),
      // Clear any stale mail banner left in the tray once the count settles
      // (e.g. a message that was read elsewhere).
      closeTags: ["gmail-push"],
    });
  } catch (err) {
    console.error("[gmail webhook] handler error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true });
}
