import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { archiveGmailThread } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Phase 6.1 archive endpoint. Removes INBOX from a thread — Gmail's
// native archive action. Scoped implicitly to the signed-in user's own
// mailbox through the per-user refresh token; no tenant/org write, so
// organizationId is irrelevant here (the Gmail account IS the tenant
// boundary for mail).
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
    await archiveGmailThread(user.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Archive failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
