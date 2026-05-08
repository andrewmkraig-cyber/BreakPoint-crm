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

// Topbar weather chip with a hover-only forecast popover. Reads the
// browser's geolocation, hits Open-Meteo (free, no API key) for the
// current conditions plus 6-hour hourly and 7-day daily slices,
// refreshes every 30 min. Silent fail on geolocation denial / network
// error — the chip renders nothing rather than an error state, so the
// topbar stays clean for users who haven't granted location.

const REFRESH_MS = 30 * 60 * 1000;
const HOURS_AHEAD = 6;
const DAYS_AHEAD = 7;

type Hourly = { time: string; tempF: number; precipPct: number; code: number };
type Daily = {
  date: string;
  highF: number;
  lowF: number;
  code: number;
  precipPctMax: number;
};
type Weather = {
  tempF: number;
  apparentF: number;
  code: number;
  hourly: Hourly[];
  daily: Daily[];
};

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

function descriptionFor(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly Clear";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing Drizzle";
  if (code === 61 || code === 63 || code === 65) return "Rainy";
  if (code === 66 || code === 67) return "Freezing Rain";
  if (code === 71 || code === 73 || code === 75) return "Snowy";
  if (code === 77) return "Snow Grains";
  if (code === 80 || code === 81 || code === 82) return "Rain Showers";
  if (code === 85 || code === 86) return "Snow Showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunder & Hail";
  return "Unknown";
}

// Open-Meteo's hourly arrays start at the local-day midnight. Find the
// first index whose timestamp is at or after "now" minus an hour so we
// include the bucket the recruiter is currently inside.
function pickHourlySlice(times: string[], now: Date): number {
  const nowMs = now.getTime();
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() + 60 * 60 * 1000 > nowMs) return i;
  }
  return 0;
}

function formatHour(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
  }).format(new Date(iso));
}

function formatDayShort(iso: string, idx: number): string {
  if (idx === 0) return "Today";
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    new Date(`${iso}T12:00:00`),
  );
}

export function WeatherWidget() {
  const [data, setData] = useState<Weather | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    let intervalId: number | undefined;

    async function fetchWeather(lat: number, lon: number) {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code` +
        `&hourly=temperature_2m,precipitation_probability,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
        `&timezone=auto&forecast_days=${DAYS_AHEAD}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn("[weather] open-meteo fetch failed", res.status);
          return;
        }
        const json = (await res.json()) as {
          current?: {
            temperature_2m?: number;
            apparent_temperature?: number;
            weather_code?: number;
          };
          hourly?: {
            time?: string[];
            temperature_2m?: number[];
            precipitation_probability?: number[];
            weather_code?: number[];
          };
          daily?: {
            time?: string[];
            temperature_2m_max?: number[];
            temperature_2m_min?: number[];
            weather_code?: number[];
            precipitation_probability_max?: number[];
          };
        };
        console.log("[weather] open-meteo response", json);

        const tempF = json.current?.temperature_2m;
        const apparentF = json.current?.apparent_temperature;
        const code = json.current?.weather_code;
        if (
          typeof tempF !== "number" ||
          typeof apparentF !== "number" ||
          typeof code !== "number"
        )
          return;

        // Hourly slice — 6 buckets starting at the current hour.
        const hTimes = json.hourly?.time ?? [];
        const hTemps = json.hourly?.temperature_2m ?? [];
        const hPrecips = json.hourly?.precipitation_probability ?? [];
        const hCodes = json.hourly?.weather_code ?? [];
        const start = pickHourlySlice(hTimes, new Date());
        const hourly: Hourly[] = [];
        for (
          let i = start;
          i < Math.min(start + HOURS_AHEAD, hTimes.length);
          i++
        ) {
          const t = hTemps[i];
          const c = hCodes[i];
          if (typeof t !== "number" || typeof c !== "number") continue;
          hourly.push({
            time: hTimes[i],
            tempF: t,
            precipPct: typeof hPrecips[i] === "number" ? hPrecips[i] : 0,
            code: c,
          });
        }

        // Daily slice — first 7 entries (today + next 6).
        const dTimes = json.daily?.time ?? [];
        const dHighs = json.daily?.temperature_2m_max ?? [];
        const dLows = json.daily?.temperature_2m_min ?? [];
        const dCodes = json.daily?.weather_code ?? [];
        const dPrecips = json.daily?.precipitation_probability_max ?? [];
        const daily: Daily[] = [];
        for (let i = 0; i < Math.min(DAYS_AHEAD, dTimes.length); i++) {
          const hi = dHighs[i];
          const lo = dLows[i];
          const c = dCodes[i];
          if (
            typeof hi !== "number" ||
            typeof lo !== "number" ||
            typeof c !== "number"
          )
            continue;
          daily.push({
            date: dTimes[i],
            highF: hi,
            lowF: lo,
            code: c,
            precipPctMax: typeof dPrecips[i] === "number" ? dPrecips[i] : 0,
          });
        }

        if (!cancelled) {
          setData({ tempF, apparentF, code, hourly, daily });
        }
      } catch (e) {
        console.warn("[weather] open-meteo fetch threw", e);
      }
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        console.log("[weather] geolocation granted", { latitude, longitude });
        void fetchWeather(latitude, longitude);
        intervalId = window.setInterval(
          () => void fetchWeather(latitude, longitude),
          REFRESH_MS,
        );
      },
      (err) => {
        console.warn("[weather] geolocation denied or failed", err);
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
  const apparentRounded = Math.round(data.apparentF);
  const description = descriptionFor(data.code);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="inline-flex cursor-default items-center gap-1 text-court-fg"
        aria-label={`Current temperature ${rounded} degrees Fahrenheit`}
      >
        <Icon className="h-4 w-4 text-court-fg-muted" aria-hidden="true" />
        <span className="text-sm font-medium tabular-nums">{rounded}°</span>
      </div>

      {hovered && (
        // Popover anchored directly under the chip, right-aligned so it
        // never spills off the right edge of the topbar. mt-2 leaves a
        // small visual gap; the parent's onMouseLeave still fires only
        // when the cursor leaves both the chip AND the popover, so the
        // gap doesn't dismiss it.
        <div
          role="dialog"
          aria-label="Forecast"
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          {/* CURRENT */}
          <div className="flex items-center gap-3">
            <Icon className="h-10 w-10 text-court-fg-muted" aria-hidden="true" />
            <div className="flex flex-col">
              <div className="flex items-baseline gap-2">
                <span className="font-stat text-3xl font-bold leading-none text-court-fg">
                  {rounded}°
                </span>
                <span className="text-[11px] text-court-fg-muted">
                  Feels {apparentRounded}°
                </span>
              </div>
              <span className="mt-1 text-sm text-court-fg">{description}</span>
            </div>
          </div>

          {/* HOURLY */}
          {data.hourly.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
                Next {data.hourly.length} Hours
              </div>
              <div className="mt-2 flex justify-between gap-1">
                {data.hourly.map((h, i) => {
                  const HIcon = iconFor(h.code);
                  const showRain = h.precipPct >= 20;
                  return (
                    <div
                      key={`${i}-${h.time}`}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <div className="text-[10px] text-court-fg-muted">
                        {i === 0 ? "Now" : formatHour(h.time)}
                      </div>
                      <HIcon
                        className="h-4 w-4 text-court-fg-muted"
                        aria-hidden="true"
                      />
                      <div className="text-xs font-medium tabular-nums text-court-fg">
                        {Math.round(h.tempF)}°
                      </div>
                      <div className="h-3 text-[10px] tabular-nums text-court-accent">
                        {showRain ? `${h.precipPct}%` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* DAILY */}
          {data.daily.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
                {data.daily.length}-Day Forecast
              </div>
              <ul className="mt-2 flex flex-col">
                {data.daily.map((d, i) => {
                  const DIcon = iconFor(d.code);
                  const showRain = d.precipPctMax >= 20;
                  return (
                    <li
                      key={`${i}-${d.date}`}
                      className="flex items-center gap-2 py-1 text-xs"
                    >
                      <span className="w-12 text-court-fg-muted">
                        {formatDayShort(d.date, i)}
                      </span>
                      <DIcon
                        className="h-4 w-4 text-court-fg-muted"
                        aria-hidden="true"
                      />
                      <span className="w-10 tabular-nums text-court-accent">
                        {showRain ? `${d.precipPctMax}%` : ""}
                      </span>
                      <span className="ml-auto font-medium tabular-nums text-court-fg">
                        {Math.round(d.highF)}°
                      </span>
                      <span className="w-8 text-right tabular-nums text-court-fg-muted">
                        {Math.round(d.lowF)}°
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
