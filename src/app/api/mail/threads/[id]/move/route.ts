import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moveGmailThread } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Mail Tab "Move to label" endpoint. Adds the chosen user label and
// drops INBOX in one atomic Gmail modify call. Same per-user-token
// scoping as the archive route — no organizationId write happens.
export async function POST(
  req: Request,
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

  const body = (await req.json().catch(() => null)) as { labelId?: string } | null;
  const labelId = body?.labelId?.trim();
  if (!labelId) {
    return NextResponse.json({ error: "labelId required" }, { status: 400 });
  }

  try {
    await moveGmailThread(user.id, params.id, labelId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Move failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
