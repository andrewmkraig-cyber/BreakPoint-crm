import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractEmailsFromHeader,
  getFreshAccessToken,
  tagThreadByAddresses,
} from "@/lib/gmail";
import { sendPushToOrg } from "@/lib/web-push";
import { getUnreadCountsForOrg } from "@/lib/unread-counts";

export const dynamic = "force-dynamic";

// Gmail Pub/Sub push receiver. Google posts to this URL every time
// the watched mailbox (INBOX) changes. We respond 200 on every code
// path — Pub/Sub treats anything else as failure and retries
// aggressively, which would melt the route during transient errors.
// The Settings card's "Enable" button is what registers the watch
// itself; this route is the consumer side.
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

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  const hit = headers.find((h) => (h.name ?? "").toLowerCase() === lower);
  return hit?.value ?? "";
}

async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
): Promise<{ addresses: string[]; labelIds: string[] }> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
  );
  url.searchParams.set("format", "metadata");
  for (const h of ["From", "To", "Cc"]) {
    url.searchParams.append("metadataHeaders", h);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return { addresses: [], labelIds: [] };
  const j = (await res.json()) as {
    labelIds?: string[];
    payload?: { headers?: GmailHeader[] };
  };
  const headers = j.payload?.headers;
  return {
    addresses: [
      ...extractEmailsFromHeader(headerValue(headers, "From")),
      ...extractEmailsFromHeader(headerValue(headers, "To")),
      ...extractEmailsFromHeader(headerValue(headers, "Cc")),
    ],
    labelIds: j.labelIds ?? [],
  };
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
    const newUnreadInboxThreads = new Set<string>();
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
            newUnreadInboxThreads.add(m.threadId);
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

    if (addedCount > 0) {
      const counts = await getUnreadCountsForOrg(organizationId, {
        extraUnreadMailThreadIds: Array.from(newUnreadInboxThreads),
      });
      await sendPushToOrg(organizationId, {
        title: "New Email",
        body: "You have a new message in Ace",
        url: "/mail",
        tag: "gmail-push",
        mailUnread: counts.mailUnread,
        phoneUnread: counts.phoneUnread,
        badgeCount: counts.badgeCount,
      });
    }
  } catch (err) {
    console.error("[gmail webhook] handler error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: true });
}
