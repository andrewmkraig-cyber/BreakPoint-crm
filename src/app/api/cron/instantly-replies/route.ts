import { NextRequest, NextResponse } from "next/server";
import { runInstantlyPoll } from "@/lib/instantly/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Instantly reply poller. Runs every 5 minutes (see vercel.json).
//
// READ ONLY against Instantly: GET /emails and GET /emails/{id}. Every
// write lands in Neon. Nothing here can send, reply, or modify anything
// in Instantly - the client exposes no method that could.
//
// The 5-minute cron is the FLOOR, not the actual cadence. Vercel cron
// schedules are static, so the user-configurable interval is enforced
// inside runInstantlyPoll(), which no-ops until the chosen interval has
// elapsed. The setting can slow polling down, never speed it past 5.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Same
// pattern as every other cron route here.

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

  const result = await runInstantlyPoll();

  // Always 200 for the cron itself - a failed poll is reported in the
  // body and recorded in poll state. Returning 5xx would make Vercel's
  // cron log noisy without changing behavior, since there are no retries.
  return NextResponse.json(result, { status: 200 });
}
