"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
} from "lucide-react";

// Tiny topbar weather chip. Reads the browser's geolocation, hits Open-
// Meteo (free, no API key), shows current °F + a weather icon, refreshes
// every 30 min. Silent fail on geolocation denial / network error — the
// widget renders nothing rather than an error state, so the topbar
// stays clean for users who haven't granted location.

const REFRESH_MS = 30 * 60 * 1000;

type Weather = { tempF: number; code: number };

// Open-Meteo follows WMO weather codes. Buckets:
//   0           — clear
//   1–3         — partly cloudy / overcast
//   45, 48      — fog
//   51–67       — drizzle / rain
//   71–77, 85–86 — snow
//   80–82       — rain showers
//   95–99       — thunderstorm
function iconFor(code: number): LucideIcon {
  if (code === 0) return Sun;
  if (code <= 3) return CloudSun;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 95) return CloudLightning;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  return Cloud;
}

export function WeatherWidget() {
  const [data, setData] = useState<Weather | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    let intervalId: number | undefined;

    async function fetchWeather(lat: number, lon: number) {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1`;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = (await res.json()) as {
          current?: { temperature_2m?: number; weather_code?: number };
        };
        const tempF = json.current?.temperature_2m;
        const code = json.current?.weather_code;
        if (
          !cancelled &&
          typeof tempF === "number" &&
          typeof code === "number"
        ) {
          setData({ tempF, code });
        }
      } catch {
        // silent fail — keep the previous reading or stay blank
      }
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        void fetchWeather(latitude, longitude);
        intervalId = window.setInterval(
          () => void fetchWeather(latitude, longitude),
          REFRESH_MS,
        );
      },
      () => {
        // denied / error — render nothing
      },
    );

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  if (!data) return null;

  const Icon = iconFor(data.code);
  const rounded = Math.round(data.tempF);
  return (
    <div
      className="inline-flex items-center gap-1 text-court-fg"
      aria-label={`Current temperature ${rounded} degrees Fahrenheit`}
    >
      <Icon className="h-4 w-4 text-court-fg-muted" aria-hidden="true" />
      <span className="text-sm font-medium tabular-nums">{rounded}°</span>
    </div>
  );
}
