import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerGmailWatch } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily refresher for Gmail INBOX watches. Gmail caps watch lifetime
// at 7 days; if we don't renew, the Pub/Sub push stops and the
// recruiter silently loses real-time mail alerts. Cron runs at 10:00
// UTC (6am EDT / 5am EST) and renews any row expiring within 24h —
// running daily on a 7-day window means we have multiple chances to
// catch each renewal before it lapses.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Anything
// else is 401 — no session attached to cron invocations.

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

type Outcome =
  | { email: string; status: "renewed"; expiresAt: string }
  | { email: string; status: "failed"; error: string };

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiring = await prisma.gmailPushWatch.findMany({
    where: { expiresAt: { lte: cutoff } },
    select: { organizationId: true, email: true },
  });

  const outcomes: Outcome[] = [];
  for (const row of expiring) {
    try {
      const user = await prisma.user.findFirst({
        where: { email: row.email },
        select: { id: true },
      });
      if (!user) {
        outcomes.push({
          email: row.email,
          status: "failed",
          error: "no matching user",
        });
        continue;
      }
      const { expiresAt } = await registerGmailWatch({
        userId: user.id,
        organizationId: row.organizationId,
        email: row.email,
      });
      outcomes.push({
        email: row.email,
        status: "renewed",
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      outcomes.push({
        email: row.email,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("[cron renew-gmail-watch]", {
    checked: expiring.length,
    outcomes,
  });
  return NextResponse.json({ ok: true, checked: expiring.length, outcomes });
}
