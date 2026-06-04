import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { syncGoogleCalendars } from "@/lib/calendar/google-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Recurring calendar sync. Mirrors what the /calendar "Sync" button does,
// but for every user with a linked Google account, on a schedule. Runs
// every 15 minutes (see vercel.json) so the calendar stays fresh without
// the recruiter having to hit Sync manually through the day.
//
// syncGoogleCalendars is a full ±90/+400-day re-scan + upsert per user.
// One bad/expired token shouldn't take down the whole run, so each user
// is wrapped in its own try/catch and we report a per-user summary.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Anything
// else is 401 — no session attached to cron invocations.

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Every distinct user that has a linked Google account. These are the
  // only users syncGoogleCalendars can pull for; everyone else would just
  // throw "No Google account linked."
  const accounts = await prisma.account.findMany({
    where: { provider: "google" },
    select: { userId: true },
    distinct: ["userId"],
  });

  const fallbackOrg = process.env.DEFAULT_ORG_ID ?? null;

  let synced = 0;
  let failed = 0;
  const errors: { userId: string; error: string }[] = [];

  for (const { userId } of accounts) {
    // Resolve the user's org the same way getCurrentOrg does for a
    // session: first membership by joinedAt, else DEFAULT_ORG_ID.
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId },
      orderBy: { joinedAt: "asc" },
      select: { organizationId: true },
    });
    const orgId = membership?.organizationId ?? fallbackOrg;
    if (!orgId) {
      failed += 1;
      errors.push({ userId, error: "No organization for user" });
      continue;
    }

    try {
      await syncGoogleCalendars(userId, orgId);
      synced += 1;
    } catch (e) {
      failed += 1;
      errors.push({ userId, error: e instanceof Error ? e.message : "Sync failed" });
    }
  }

  return NextResponse.json({
    ok: true,
    usersConsidered: accounts.length,
    synced,
    failed,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
