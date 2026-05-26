import { NextResponse, type NextRequest } from "next/server";

// Server-side proxy for the Open-Meteo current/hourly/daily forecast.
//
// The topbar weather chip used to hit `api.open-meteo.com` directly from
// the browser. That worked most of the time, but when Open-Meteo's edge
// returns a Cloudflare 502 the response carries no CORS headers, so the
// browser reports it as a CORS error and the chip stays empty. Routing
// the request through this proxy means the chip only ever talks to its
// own origin: CORS is impossible, and a transient 502 surfaces as a 502
// JSON the client can retry without a CSP / CORS detour.
//
// No auth: weather is public and the route returns no tenant data.
// Middleware (`src/middleware.ts`) already skips `/api/*`, so a logged-
// out PWA cold-load can still resolve the chip.

export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Numeric guard for the lat/lon query params. Open-Meteo will happily
// 400 on garbage, but rejecting up-front gives a cleaner client error
// and saves the upstream round-trip.
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
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code` +
    `&hourly=temperature_2m,precipitation_probability,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&timezone=auto&forecast_days=7`;

  try {
    const res = await fetch(upstream, {
      // Identify the proxy in upstream logs - useful if Open-Meteo ever
      // tightens free-tier rate limiting and we need to negotiate.
      headers: { "user-agent": "ace-crm/1.0 (+https://ace.breakpointtalent.com)" },
      // 5-minute server-side cache. The client already refreshes every
      // 30 min per chip; sharing across recruiters / PWA tabs keeps the
      // upstream count low without showing stale data.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "upstream_error", status: res.status, body: body.slice(0, 200) },
        { status: 502 },
      );
    }
    const json = await res.json();
    return NextResponse.json(json, {
      headers: {
        // Browser sees the cached response for 60s; CDN holds for 5 min
        // and may serve stale-while-revalidate for another 5 while a
        // background refresh runs. Open-Meteo's current-conditions tick
        // on a 10-15 min cadence so this is comfortably fresh.
        "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.warn("[api/weather] open-meteo fetch threw", err);
    return NextResponse.json(
      { error: "upstream_unreachable" },
      { status: 502 },
    );
  }
}
