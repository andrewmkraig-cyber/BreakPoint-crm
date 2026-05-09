import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/auth/getCurrentOrg";

// Daily "on this day" event for the briefing header, shared across the
// org. The route hits Wikipedia's public REST feed at most once per
// (org, ET day), runs pickEvent server-side (favoring older +
// substantive entries), and persists the chosen year + text. Every
// later load for any user in the same org returns the cached row, so
// recruiters discussing the same fact see the same fact.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type WikiEvent = {
  year?: number;
  text?: string;
};

type WikiResponse = {
  events?: WikiEvent[];
};

type Pick = {
  year: number;
  text: string;
};

function todayInEastern(): { mm: string; dd: string; date: Date } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  // UTC noon — keeps the @db.Date projection on the intended ET day.
  return {
    mm: String(m).padStart(2, "0"),
    dd: String(d).padStart(2, "0"),
    date: new Date(Date.UTC(y, m - 1, d, 12, 0, 0)),
  };
}

// Bias toward older events with a substantive blurb so the result
// reads as a fun fact rather than a recent-tragedy ticker. Mirrors
// the heuristic that used to live in the client component.
function pickEvent(events: WikiEvent[]): Pick | null {
  const candidates = events
    .filter((e) => typeof e.year === "number" && (e.text ?? "").length > 30)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  if (candidates.length === 0) return null;
  const old = candidates.filter((e) => (e.year ?? 0) < 1950);
  const pool = old.length > 0 ? old : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { year: pick.year ?? 0, text: pick.text ?? "" };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const org = await getCurrentOrg();
  const { mm, dd, date: generatedDate } = todayInEastern();

  const cached = await prisma.onThisDayEvent.findUnique({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
  });
  if (cached) {
    return NextResponse.json({
      ok: true,
      cached: true,
      year: cached.year,
      text: cached.text,
    });
  }

  let pick: Pick | null = null;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Wikipedia HTTP ${res.status}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as WikiResponse;
    pick = pickEvent(json.events ?? []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Wikipedia fetch failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
  if (!pick) {
    return NextResponse.json(
      { ok: false, error: "No usable events for today" },
      { status: 502 },
    );
  }

  const row = await prisma.onThisDayEvent.upsert({
    where: {
      organizationId_generatedDate: {
        organizationId: org.id,
        generatedDate,
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      year: pick.year,
      text: pick.text,
      generatedDate,
    },
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    year: row.year,
    text: row.text,
  });
}
