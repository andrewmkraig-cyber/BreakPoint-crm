import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }

  // Scope delete to caller — a user can't unsubscribe another user's
  // device by guessing the endpoint. deleteMany so deleting a row that
  // doesn't exist (already gone) is a no-op, not a 404.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: body.endpoint, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
