import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fireScheduledEmail } from "@/lib/scheduled-email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-minute firer for "Send Later" emails. Picks up every ScheduledEmail
// whose scheduledSendAt has passed and sends it through the same Gmail
// path the live composer uses. Vercel cron runs in UTC; scheduledSendAt
// is stored as an absolute UTC instant, so no timezone math here.
//
// Vercel does not retry failed crons, so the job is self-contained: each
// row it fires flips to SENT or FAILED inside fireScheduledEmail. A
// FAILED row is surfaced to the recruiter via the app-shell poller and
// can be retried from the toast.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Anything
// else is 401 — no session attached to cron invocations.

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

// Cap per tick so a backlog can't blow past maxDuration. Anything left
// over fires on the next minute's run.
const BATCH_SIZE = 25;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const due = await prisma.scheduledEmail.findMany({
    where: { status: "SCHEDULED", scheduledSendAt: { lte: new Date() } },
    orderBy: { scheduledSendAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const result = await fireScheduledEmail(row);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({
    ok: true,
    processed: due.length,
    sent,
    failed,
  });
}
