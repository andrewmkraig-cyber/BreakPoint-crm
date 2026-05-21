import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { sendPushToUser, type PushPayload } from "@/lib/web-push";
import { getUnreadCountsForOrg } from "@/lib/unread-counts";
import { badgePayloadFields } from "@/lib/badge-math";

export const dynamic = "force-dynamic";

// Client-fired push relay. The mail + reminder toasts run in browser
// JS, where sendPushToUser can't be reached directly (server-only
// imports: Prisma client, web-push). The client POSTs the same
// title/body/url it just toasted; the server resolves the caller's
// user + org from the NextAuth session and dispatches to every
// subscribed device on that user's account.
//
// Practical effect: when /mail or /calendar polls in tab A and fires
// a toast, every other subscribed device of the same user also gets
// a system notification. Tab A still sees its toast — the SW push
// handler isn't gated on visibility (Anthropic-cookbook style: deliver
// everywhere, let the user dismiss). If that ever feels noisy we can
// add a `self.clients.matchAll({ visibilityState: 'visible' })`
// short-circuit in sw.js without touching this route.

type FireBody = Partial<PushPayload>;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: FireBody;
  try {
    body = (await req.json()) as FireBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.title || !body.body) {
    return NextResponse.json(
      { error: "title and body required" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }
  const org = await getCurrentOrg();
  const counts = await getUnreadCountsForOrg(org.id);

  // TEMP DIAG (keep until badge reliability confirmed in prod).
  console.log("[push][badge-diag]", {
    source: "push-fire",
    mailUnread: counts.mailUnread,
    phoneUnread: counts.phoneUnread,
    badgeCount: counts.badgeCount,
    mailReliable: counts.mailReliable,
    badgeOmitted: counts.badgeCount === null,
  });

  await sendPushToUser(user.id, org.id, {
    title: body.title,
    body: body.body,
    url: body.url,
    tag: body.tag,
    ...badgePayloadFields(counts),
  });

  return NextResponse.json({ ok: true });
}
