import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteGmailLabel, patchGmailLabel } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// PATCH and DELETE for a single Gmail label. Used by the Ace mail
// sidebar's per-label context menu so the recruiter can rename, move
// (re-parent via the Gmail "/" separator inside the label name), or
// delete a label without leaving Ace.

async function requireUserId(): Promise<{ id: string } | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 401 });
  return user;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const userOrErr = await requireUserId();
  if (userOrErr instanceof NextResponse) return userOrErr;

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const label = await patchGmailLabel(userOrErr.id, params.id, { name });
    return NextResponse.json({ label });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Patch label failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const userOrErr = await requireUserId();
  if (userOrErr instanceof NextResponse) return userOrErr;

  try {
    await deleteGmailLabel(userOrErr.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete label failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
