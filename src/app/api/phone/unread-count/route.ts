import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Lightweight count endpoint for the sidebar Phone-tab badge. Polled
// every 30s by PhoneContext on the same cadence as MailContext's
// /api/mail/unread endpoint, so we keep this hot path cheap.
//
// Phase 1: SmsMessage doesn't carry an explicit read/unread field, so
// the count is always 0 — the badge stays hidden until read tracking
// ships. When that field exists, replace the 0 below with:
//   await prisma.smsMessage.count({
//     where: {
//       organizationId: org.id,
//       direction: 'inbound',
//       readAt: null,
//     },
//   })
// Calls deliberately don't contribute — only unread inbound texts.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ count: 0 });
  }
  return NextResponse.json({ count: 0 });
}
