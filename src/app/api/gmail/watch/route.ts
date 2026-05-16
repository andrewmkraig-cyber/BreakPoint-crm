import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { registerGmailWatch } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Registers (or renews) the Gmail INBOX push watch for the signed-in
// user. Fired by the "Enable / Renew" button on the Settings →
// Connectors → Gmail Push Notifications card. Gmail caps watch
// lifetime at 7 days; the daily renew-gmail-watch cron handles
// the rest. Calling this when a watch is already active is fine —
// Gmail returns a fresh expiration and registerGmailWatch upserts.

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 401 });
  }
  const org = await getCurrentOrg();

  try {
    const { expiresAt } = await registerGmailWatch({
      userId: user.id,
      organizationId: org.id,
      email: email.toLowerCase().trim(),
    });
    return NextResponse.json({ ok: true, expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "watch failed";
    console.error("[gmail watch] register failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
