import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";
import { getInstantlyPrefs } from "@/lib/instantly/prefs";
import { syncReadFromInstantly } from "@/lib/instantly/inbound-read-sync";

export const dynamic = "force-dynamic";

// On-demand Instantly -> Ace read sync.
//
// The cron already runs this every 5 minutes, which bounds the worst
// case. This route exists for the case that actually happens: you read
// the thread in Instantly, tab straight back to Ace, and the badge is
// still sitting there. The browser calls this when the tab regains
// focus, so the round trip you just made through Instantly is the
// trigger, not a timer.
//
// THROTTLED IN THE DATABASE, not just in the browser. A focus handler is
// exactly the kind of thing that fires in bursts (alt-tab, multiple Ace
// tabs, a flaky window manager), and every un-throttled call would spend
// an /emails slot from a 20-per-minute budget shared with the Replies
// page. The floor lives here because a client-side guard only covers one
// tab in one browser.

const MIN_INTERVAL_MS = 45_000;
const THROTTLE_KEY = "instantly.inbound-read-sync";

async function lastRunAt(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: THROTTLE_KEY } });
  const v = (row?.value ?? {}) as { lastRunAt?: string };
  const t = v.lastRunAt ? new Date(v.lastRunAt).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

async function stampRun(at: Date): Promise<void> {
  const value = { lastRunAt: at.toISOString() };
  await prisma.setting.upsert({
    where: { key: THROTTLE_KEY },
    create: { key: THROTTLE_KEY, value },
    update: { value },
  });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  try {
    const prefs = await getInstantlyPrefs();
    if (!prefs.clearReadFromInstantly) {
      return NextResponse.json({ ok: true, ran: false, reason: "disabled" }, { status: 200 });
    }

    const now = new Date();
    const since = now.getTime() - (await lastRunAt());
    if (since < MIN_INTERVAL_MS) {
      return NextResponse.json(
        { ok: true, ran: false, reason: "throttled", retryInMs: MIN_INTERVAL_MS - since },
        { status: 200 },
      );
    }
    // Stamped BEFORE the work, so a slow run cannot let a second caller
    // slip past the floor while the first is still in flight.
    await stampRun(now);

    const org = await getCurrentOrg();
    const result = await syncReadFromInstantly(org.id);

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    // 200 with ok:false, matching the other /api/instantly routes - a
    // failed reconcile is not a transport error, and the badge is
    // unaffected either way.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Read sync failed." },
      { status: 200 },
    );
  }
}
