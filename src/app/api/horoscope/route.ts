import { NextRequest, NextResponse } from "next/server";

// Server-side proxy for the public horoscope-app-api so the dashboard
// chip doesn't get blocked by CORS — the upstream redirects to
// freehoroscopeapi.com, which returns no Access-Control-Allow-Origin
// header on browser requests. Pulling the response server-side and
// re-emitting it as same-origin JSON sidesteps that entirely.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_SIGNS = new Set([
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

export async function GET(req: NextRequest) {
  const sign = (req.nextUrl.searchParams.get("sign") ?? "pisces").toLowerCase();
  if (!ALLOWED_SIGNS.has(sign)) {
    return NextResponse.json(
      { ok: false, error: `Unknown sign: ${sign}` },
      { status: 400 },
    );
  }

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
