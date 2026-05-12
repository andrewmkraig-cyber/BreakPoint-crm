import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markGmailThreadUnread } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Re-applies UNREAD to a thread the recruiter has already opened, so
// it pops back to bold in Gmail and they can come back to it later.
// Mirrors the /read endpoint — same auth pattern, same scope boundary
// (per-user OAuth refresh token is the tenant boundary for mail).
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
    await markGmailThreadUnread(user.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mark-unread failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
