import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { registerGmailWatch } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Idempotent "make sure the Gmail INBOX watch is armed" endpoint, called
// fire-and-forget when the app shell mounts (see GmailWatchKeepalive).
//
// This is what makes the silent cross-device mail-badge sync FULLY
// AUTOMATIC: there is no Settings toggle anymore, so app-open is the
// bootstrap that arms (or re-arms) the watch, and the daily
// renew-gmail-watch cron is the backstop for stretches where Ace isn't
// opened. The recruiter never re-enables anything by hand.
//
// Cheap in the steady state - a single indexed row read - and only calls
// Gmail users.watch when the watch is missing or inside the renewal
// window. Never throws to the caller: arming the watch is best-effort
// background work, so a Gmail hiccup must not surface as a client error.

// Re-arm when the watch is missing or expires within this window. Gmail
// caps watch lifetime at ~7 days; 48h gives the daily cron and the next
// app-open multiple chances to renew before it actually lapses.
const RENEW_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function POST() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase().trim();
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
    const existing = await prisma.gmailPushWatch.findUnique({
      where: { organizationId_email: { organizationId: org.id, email } },
      select: { expiresAt: true },
    });
    const fresh =
      !!existing &&
      existing.expiresAt.getTime() - Date.now() > RENEW_WINDOW_MS;
    if (fresh) {
      return NextResponse.json({ ok: true, status: "already-armed" });
    }
    const { expiresAt } = await registerGmailWatch({
      userId: user.id,
      organizationId: org.id,
      email,
    });
    return NextResponse.json({
      ok: true,
      status: existing ? "renewed" : "created",
      expiresAt,
    });
  } catch (err) {
    // Best-effort: return 200 with ok:false so the fire-and-forget client
    // call doesn't log a network error. The cron is the backstop.
    const message = err instanceof Error ? err.message : "ensure failed";
    console.error("[gmail watch ensure] failed", { message });
    return NextResponse.json({ ok: false, error: message });
  }
}
