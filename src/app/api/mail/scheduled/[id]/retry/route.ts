import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fireScheduledEmail } from "@/lib/scheduled-email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Retry a failed scheduled email from the failure toast. Resets the row to
// SCHEDULED (clearing the acknowledged flag) and fires it immediately so
// the recruiter gets an instant result rather than waiting for the next
// cron tick. Scoped to the signed-in user so a forged id from another
// session can't reach across.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  const existing = await prisma.scheduledEmail.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.status === "SENT") {
    return NextResponse.json({ ok: true, alreadySent: true });
  }

  // Reset to SCHEDULED with a now timestamp so fireScheduledEmail can
  // claim it. failureAcknowledged clears so a second failure re-surfaces.
  const reset = await prisma.scheduledEmail.update({
    where: { id: existing.id },
    data: {
      status: "SCHEDULED",
      scheduledSendAt: new Date(),
      failureAcknowledged: false,
      lastError: null,
    },
  });

  const result = await fireScheduledEmail(reset);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
