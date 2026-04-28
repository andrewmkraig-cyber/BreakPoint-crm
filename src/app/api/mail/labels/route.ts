import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGmailLabel, listGmailAllLabels } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Mail Tab labels endpoint. Returns every Gmail label (system + user)
// with id, name, type, and messagesTotal so the client can build the
// nested-label sidebar AND still feed user labels into the Move To
// dropdown. Scoped implicitly to the signed-in user's own mailbox via
// the per-user OAuth refresh token.
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
    const labels = await listGmailAllLabels(user.id);
    return NextResponse.json({ labels });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load labels";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Creates a new user label in the signed-in user's mailbox. The Move To
// dropdown calls this when the recruiter picks "New label…", then turns
// around and applies the returned id to the current thread via the
// existing /threads/[id]/move endpoint.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  try {
    const label = await createGmailLabel(user.id, name);
    return NextResponse.json({ label });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Create label failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
