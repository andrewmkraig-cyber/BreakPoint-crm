import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markGmailThreadRead } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Ace 22.0 mark-read endpoint. Removes UNREAD from the given thread —
// Gmail's native "mark as read." Fired fire-and-forget by the Mail Tab
// when a thread opens, so the user's phone / laptop Gmail apps stop
// buzzing on the same message. Errors are surfaced as 502 but the
// caller deliberately ignores them so a Gmail hiccup never blocks the
// thread from rendering.
//
// Scope: the per-user OAuth refresh token IS the tenant boundary for
// mail. No organizationId write happens here.
export async function POST(
  _req: Request,
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

  try {
    await markGmailThreadRead(user.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mark-read failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
