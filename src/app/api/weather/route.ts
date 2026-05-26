import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) {
    return NextResponse.json(
      { error: "Missing or invalid lat/lon" },
      { status: 400 }
    );
  }

  const upstream = new URL("https://api.open-meteo.com/v1/forecast");

  upstream.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,apparent_temperature,weather_code",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    forecast_days: "7",
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(upstream.toString(), {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      console.error("[weather] Open-Meteo failed", {
        status: res.status,
        body: text.slice(0, 300),
      });
      return NextResponse.json(
        { error: "Weather upstream failed" },
        { status: 502 }
      );
    }

    return new NextResponse(text, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[weather] fetch failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Weather fetch failed" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
