import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Feeds the app-shell failure poller. Returns the signed-in user's
// scheduled emails that failed to send and haven't been acknowledged yet,
// so the poller can raise a toast with the subject + a Retry button.
// Scoped to userId (the row's owner) so one recruiter never sees another's
// failures.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ items: [] });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ items: [] });

  const rows = await prisma.scheduledEmail.findMany({
    where: { userId: user.id, status: "FAILED", failureAcknowledged: false },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      subject: true,
      to: true,
      lastError: true,
      attempts: true,
      scheduledSendAt: true,
      timezone: true,
    },
  });

  return NextResponse.json({ items: rows });
}
