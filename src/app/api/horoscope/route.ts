import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ZODIAC_DISPLAY, zodiacFromDate, type ZodiacSign } from "@/lib/zodiac";

// Server-side proxy for the public horoscope-app-api so the dashboard
// chip doesn't get blocked by CORS — the upstream redirects to
// freehoroscopeapi.com, which returns no Access-Control-Allow-Origin
// header on browser requests. Pulling the response server-side and
// re-emitting it as same-origin JSON sidesteps that entirely.
//
// Sign resolution: if the caller passes ?sign=X we honor it. Otherwise
// the route looks up the signed-in user's UserProfile.birthday and
// derives the zodiac sign automatically. With no birthday and no
// query param, falls back to "pisces" (Andrew's sign — the historical
// hardcoded default before per-user birthdays existed).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_SIGNS = new Set<ZodiacSign>([
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
]);

type UpstreamResponse = {
  data?: {
    date?: string;
    period?: string;
    sign?: string;
    horoscope?: string;
  };
};

async function resolveSignFromBirthday(): Promise<ZodiacSign | null> {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return null;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { profile: { select: { birthday: true } } },
    });
    const birthday = user?.profile?.birthday;
    if (!birthday) return null;
    return zodiacFromDate(birthday);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const queryParam = req.nextUrl.searchParams.get("sign");
  let sign: ZodiacSign;
  if (queryParam) {
    const candidate = queryParam.toLowerCase() as ZodiacSign;
    if (!ALLOWED_SIGNS.has(candidate)) {
      return NextResponse.json(
        { ok: false, error: `Unknown sign: ${queryParam}` },
        { status: 400 },
      );
    }
    sign = candidate;
  } else {
    sign = (await resolveSignFromBirthday()) ?? "pisces";
  }

  const display = ZODIAC_DISPLAY[sign];

  try {
    const upstream = await fetch(
      `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${sign}&day=TODAY`,
      { cache: "no-store", redirect: "follow" },
    );
    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `Upstream HTTP ${upstream.status}` },
        { status: 502 },
      );
    }
    const json = (await upstream.json()) as UpstreamResponse;
    const text = json.data?.horoscope?.trim();
    if (!text) {
      return NextResponse.json(
        { ok: false, error: "Upstream returned empty horoscope" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      sign,
      displayName: display.name,
      glyph: display.glyph,
      date: json.data?.date ?? null,
      horoscope: text,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Horoscope fetch failed",
      },
      { status: 502 },
    );
  }
}
