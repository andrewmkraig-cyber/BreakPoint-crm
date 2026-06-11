import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";
import { phoneUnreadMessageCount } from "@/lib/badge-math";
import { getQuoLineDigitsForUserEmail, smsLineWhere } from "@/lib/quo-line-owner";

export const dynamic = "force-dynamic";

// Lightweight count endpoint for the Phone notification badge (sidebar,
// mobile nav, tab title, PWA app icon). Polled every 30s by PhoneContext
// on the same cadence as MailContext's /api/mail/unread endpoint, so we
// keep this hot path cheap.
//
// Returns the number of unread inbound SMS *messages* (notification
// items), NOT distinct conversations. Five texts from one number are
// five things to read, so the badge reads 5 - it used to collapse them
// to a single unread conversation, which is why the badge stayed at 1.
// The Phone-tab left-rail triage badges still count conversations
// (/api/phone/threads) - that's a separate "people to reply to" surface.
// Calls don't contribute - only unread inbound texts.
//
// On an unresolved session this returns count: null (UNKNOWN), never 0.
// PhoneContext treats a non-number as "keep the last-known count" so a
// transient auth blip during a poll can't zero a known-good badge - the
// client-side analog of the null-vs-0 rule in badge-math.ts.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ count: null });
  }
  const org = await getCurrentOrg();
  const lineDigits = await getQuoLineDigitsForUserEmail(org.id, session.user.email);
  if (lineDigits.length === 0) {
    return NextResponse.json({ count: 0 });
  }
  const rows = await prisma.smsMessage.findMany({
    where: {
      organizationId: org.id,
      direction: "inbound",
      isRead: false,
      AND: [smsLineWhere(lineDigits, "inbound")],
    },
    select: { direction: true, isRead: true },
  });
  return NextResponse.json({ count: phoneUnreadMessageCount(rows) });
}
