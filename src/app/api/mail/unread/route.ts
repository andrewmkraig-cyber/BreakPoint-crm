import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUnreadInboxSummary } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Live-poll endpoint for the sidebar badge + tab title + new-mail
// toasts. Returns both the unread count and a handful of unread
// thread summaries so the client can detect newly-arrived threads
// (by id-set diff, not just count delta) and surface them.
//
// On an unresolved session/user this returns count: null (UNKNOWN), never
// 0. MailContext treats a non-number count as "keep the last-known value"
// so a transient auth blip mid-poll can't zero a known-good mail badge -
// which, combined with phone clearing, was making the whole title/favicon
// total disappear until a hard refresh.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ count: null, latest: [] }, { status: 200 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user)
    return NextResponse.json({ count: null, latest: [] }, { status: 200 });
  const summary = await getUnreadInboxSummary(user.id);
  return NextResponse.json(summary);
}
