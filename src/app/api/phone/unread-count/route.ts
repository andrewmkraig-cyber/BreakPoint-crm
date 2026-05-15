import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Lightweight count endpoint for the sidebar Phone-tab badge. Polled
// every 30s by PhoneContext on the same cadence as MailContext's
// /api/mail/unread endpoint, so we keep this hot path cheap.
//
// Returns the number of distinct unread CONVERSATIONS, not the number
// of unread messages. The earlier implementation counted message rows,
// which inflated the badge whenever a thread had multiple unread
// inbounds (one conversation with six unread texts read as 6). Mail's
// /api/mail/unread runs at thread granularity, so counting threads
// here keeps the two sources directly addable for the badge total.
// Thread identity follows the same coalesce the Phone tab uses for
// row grouping: candidateId, else clientId, else the bare fromNumber.
// Calls don't contribute — only unread inbound texts.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ count: 0 });
  }
  const org = await getCurrentOrg();
  const rows = await prisma.smsMessage.findMany({
    where: {
      organizationId: org.id,
      direction: "inbound",
      isRead: false,
    },
    select: { candidateId: true, clientId: true, fromNumber: true },
  });
  const threadKeys = new Set<string>();
  for (const r of rows) {
    threadKeys.add(r.candidateId ?? r.clientId ?? r.fromNumber);
  }
  return NextResponse.json({ count: threadKeys.size });
}
