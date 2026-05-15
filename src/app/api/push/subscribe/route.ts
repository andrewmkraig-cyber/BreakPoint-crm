import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

export const dynamic = "force-dynamic";

// POST body shape comes straight from `PushSubscription.toJSON()` in the
// browser: { endpoint, expirationTime, keys: { p256dh, auth } }. The
// route flattens keys into top-level columns so sender code doesn't
// have to know the nested shape.
type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { error: "endpoint, keys.p256dh, keys.auth required" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }
  const org = await getCurrentOrg();

  // Upsert on endpoint: the same browser may re-subscribe (e.g. after
  // a service-worker reinstall) and we want one row per (browser,
  // VAPID key) tuple. The update path resets userId / organizationId
  // so a device that switches accounts re-binds correctly.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint,
      p256dh,
      auth,
      userId: user.id,
      organizationId: org.id,
      userAgent: body.userAgent ?? req.headers.get("user-agent") ?? null,
    },
    update: {
      p256dh,
      auth,
      userId: user.id,
      organizationId: org.id,
      userAgent: body.userAgent ?? req.headers.get("user-agent") ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
