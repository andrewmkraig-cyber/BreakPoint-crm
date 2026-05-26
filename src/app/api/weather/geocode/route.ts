import { NextResponse, type NextRequest } from "next/server";

// Server-side proxy for the BigDataCloud keyless reverse-geocode call
// (lat/lon → "City, ST" label for the weather popover header). Pairs
// with `/api/weather`: routing both through the same origin avoids the
// CORS-error-on-upstream-502 trap that left the chip blank when
// BigDataCloud's edge hiccupped.

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function parseCoord(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseCoord(searchParams.get("lat"), -90, 90);
  const lon = parseCoord(searchParams.get("lon"), -180, 180);
  if (lat === null || lon === null) {
    return NextResponse.json(
      { error: "lat and lon query params are required" },
      { status: 400 },
    );
  }

  const upstream =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${lat}&longitude=${lon}&localityLanguage=en`;

  try {
    const res = await fetch(upstream, {
      headers: { "user-agent": "ace-crm/1.0 (+https://ace.breakpointtalent.com)" },
      // City labels for a given lat/lon don't change - 24h cache on the
      // CDN keeps cost down without losing freshness. The recruiter's
      // city only refreshes when they grant new coords.
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "upstream_error", status: res.status },
        { status: 502 },
      );
    }
    const json = await res.json();
    return NextResponse.json(json, {
      headers: {
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.warn("[api/weather/geocode] bigdatacloud fetch threw", err);
    return NextResponse.json(
      { error: "upstream_unreachable" },
      { status: 502 },
    );
  }
}
