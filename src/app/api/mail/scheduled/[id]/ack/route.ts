import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Dismiss a failure toast. Marks the row acknowledged so the app-shell
// poller stops re-surfacing it (including after a page reload). Scoped to
// the signed-in user.

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

  await prisma.scheduledEmail.updateMany({
    where: { id: params.id, userId: user.id, status: "FAILED" },
    data: { failureAcknowledged: true },
  });
  return NextResponse.json({ ok: true });
}
