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
// Counts inbound SmsMessages with isRead=false in the caller's org.
// Calls deliberately don't contribute — only unread inbound texts.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ count: 0 });
  }
  const org = await getCurrentOrg();
  const count = await prisma.smsMessage.count({
    where: {
      organizationId: org.id,
      direction: "inbound",
      isRead: false,
    },
  });
  return NextResponse.json({ count });
}
