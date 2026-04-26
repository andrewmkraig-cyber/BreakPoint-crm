import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listGmailUserLabels } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Mail Tab labels endpoint. Returns the signed-in user's user-created
// Gmail labels for the Move To dropdown. Scoped implicitly to the
// signed-in user's own mailbox via the per-user OAuth refresh token.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  try {
    const labels = await listGmailUserLabels(user.id);
    return NextResponse.json({ labels });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load labels";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
