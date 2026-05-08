"use client";

import { useEffect, useState } from "react";
import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Topbar weather chip with a hover-only forecast popover. Reads the
// browser's geolocation, hits Open-Meteo (free, no API key) for the
// current conditions plus 6-hour hourly and 7-day daily slices,
// refreshes every 30 min.
//
// If geolocation is unavailable or the user denied it, we fall back
// to BreakPoint's home base (Cleveland) so the chip always renders —
// the recruiter caught it disappearing whenever the browser revoked
// the permission, and an empty topbar slot looked like a regression.

const REFRESH_MS = 30 * 60 * 1000;
const HOURS_AHEAD = 6;
const DAYS_AHEAD = 7;
// Cleveland, OH — BreakPoint's office. Used when the browser hasn't
// granted geolocation so weather still renders.
const FALLBACK_LAT = 41.4993;
const FALLBACK_LON = -81.6944;

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
  isCurrentDay: boolean;
};

// Open-Meteo follows WMO weather codes. Buckets:
//   0, 1        — clear / mainly clear
//   2           — partly cloudy (2-tone glyph)
//   3           — overcast
//   45, 48      — fog
//   51–67       — drizzle / rain
//   71–77, 85–86 — snow
//   80–82       — rain showers
//   95–99       — thunderstorm
function iconFor(code: number, isDay: boolean): LucideIcon {
  if (code === 0 || code === 1) return isDay ? Sun : Moon;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return Cloud;
  if (code >= 95) return CloudLightning;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  return Cloud;
}

// Tailwind classes per weather bucket. Used for single-tone icons —
// code 2 (partly cloudy) bypasses this and renders via the 2-tone
// PartlyCloudy{Day,Night}Icon glyphs below so the celestial body and
// cloud halves can carry different colors.
function colorFor(code: number, isDay: boolean): string {
  if (code === 0 || code === 1) return isDay ? "text-amber-400" : "text-slate-300";
  if (code === 3) return "text-court-fg-muted";
  if (code === 45 || code === 48) return "text-court-fg-muted";
  if (code >= 95) return "text-purple-500";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "text-sky-300";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "text-blue-500";
  return "text-court-fg-muted";
}

// Day 2-tone partly-cloudy glyph: amber sun + muted-grey cloud.
// Lucide's CloudSun renders all paths in `currentColor`, so we split
// the sun rays and cloud body into separate <g> groups to tint each
// half independently.
function PartlyCloudyDayIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <g className="text-amber-400" stroke="currentColor">
        <path d="M12 2v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="M20 12h2" />
        <path d="m19.07 4.93-1.41 1.41" />
        <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
      </g>
      <g className="text-court-fg-muted" stroke="currentColor">
        <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
      </g>
    </svg>
  );
}

// Night counterpart: slate moon + muted-grey cloud. Paths copied from
// Lucide's CloudMoon icon and split so the moon and cloud carry
// different tints.
function PartlyCloudyNightIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <g className="text-slate-300" stroke="currentColor">
        <path d="M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36" />
      </g>
      <g className="text-court-fg-muted" stroke="currentColor">
        <path d="M13 16a3 3 0 0 1 0 6H7a5 5 0 1 1 4.9-6z" />
      </g>
    </svg>
  );
}

// Single dispatch point for every weather-icon render. Code 2 (partly
// cloudy) gets the 2-tone glyph; every other bucket falls back to the
// matching Lucide icon plus a single tint from colorFor. The same
// (code, isDay) pair always produces the same icon and color so the
// current, hourly, and daily views stay visually consistent.
function WeatherIcon({
  code,
  isDay,
  sizeClass,
}: {
  code: number;
  isDay: boolean;
  sizeClass: string;
}) {
  if (code === 2) {
    return isDay ? (
      <PartlyCloudyDayIcon className={sizeClass} />
    ) : (
      <PartlyCloudyNightIcon className={sizeClass} />
    );
  }
  const Icon = iconFor(code, isDay);
  return (
    <Icon
      className={`${sizeClass} ${colorFor(code, isDay)}`}
      aria-hidden="true"
    />
  );
}

// Hour-of-day daylight check for the hourly strip: night runs from
// 8pm through 5:59am local time. Cheap and predictable — we don't try
// to thread per-hour sunrise/sunset through every cell.
function isHourDay(iso: string): boolean {
  const h = new Date(iso).getHours();
  return h >= 6 && h < 20;
}

// Day-of-month with English ordinal suffix ("7th", "1st", "22nd").
// Intl.DateTimeFormat doesn't surface ordinals, so we fold this in by
// hand for the "Thursday, May 7th, 2026" header in the popover.
function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatTodayLong(): string {
  const d = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "America/New_York",
  }).format(d);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "America/New_York",
  }).format(d);
  const dayParts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: "America/New_York",
  }).format(d);
  const day = Number(dayParts);
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: "America/New_York",
  }).format(d);
  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}, ${year}`;
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
    let cancelled = false;
    let intervalId: number | undefined;

    async function fetchWeather(lat: number, lon: number) {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code` +
        `&hourly=temperature_2m,precipitation_probability,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset` +
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
            sunrise?: string[];
            sunset?: string[];
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

        // Current day/night derived from today's sunrise/sunset. Both
        // come back in the local timezone (timezone=auto on the
        // request) so a plain Date() comparison against the wall-clock
        // works without any extra TZ math.
        const sunriseIso = json.daily?.sunrise?.[0];
        const sunsetIso = json.daily?.sunset?.[0];
        let isCurrentDay = true;
        if (sunriseIso && sunsetIso) {
          const nowMs = Date.now();
          const sunriseMs = new Date(sunriseIso).getTime();
          const sunsetMs = new Date(sunsetIso).getTime();
          isCurrentDay = nowMs >= sunriseMs && nowMs < sunsetMs;
        }

        if (!cancelled) {
          setData({ tempF, apparentF, code, hourly, daily, isCurrentDay });
        }
      } catch (e) {
        console.warn("[weather] open-meteo fetch threw", e);
      }
    }

    function startWith(lat: number, lon: number, source: string) {
      console.log("[weather] starting fetch loop", { lat, lon, source });
      void fetchWeather(lat, lon);
      intervalId = window.setInterval(
        () => void fetchWeather(lat, lon),
        REFRESH_MS,
      );
    }

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          startWith(pos.coords.latitude, pos.coords.longitude, "geolocation");
        },
        (err) => {
          if (cancelled) return;
          console.warn(
            "[weather] geolocation denied or failed, using Cleveland fallback",
            err,
          );
          startWith(FALLBACK_LAT, FALLBACK_LON, "fallback");
        },
        { timeout: 5000 },
      );
    } else {
      startWith(FALLBACK_LAT, FALLBACK_LON, "fallback-no-geolocation");
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  if (!data) return null;

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
        className="inline-flex cursor-default items-center gap-1.5 text-court-fg"
        aria-label={`Current temperature ${rounded} degrees Fahrenheit`}
      >
        <WeatherIcon
          code={data.code}
          isDay={data.isCurrentDay}
          sizeClass="h-5 w-5"
        />
        <span className="text-base font-medium tabular-nums">{rounded}°</span>
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
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-court-border bg-court-surface p-4 shadow-xl"
        >
          {/* CURRENT — left: icon + temp + description; right: today's
              full date so the recruiter can read it without leaving
              the dashboard. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <WeatherIcon
                code={data.code}
                isDay={data.isCurrentDay}
                sizeClass="h-9 w-9"
              />
              <div className="flex flex-col">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-stat text-2xl font-bold leading-none text-court-fg">
                    {rounded}°
                  </span>
                  <span className="text-[11px] text-court-fg-muted">
                    (feels {apparentRounded}°)
                  </span>
                </div>
                <span className="mt-0.5 text-xs text-court-fg">
                  {description}
                </span>
              </div>
            </div>
            <span className="max-w-[7rem] text-right text-[10px] leading-snug text-court-fg-muted">
              {formatTodayLong()}
            </span>
          </div>

          {/* HOURLY */}
          {data.hourly.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
                Next {data.hourly.length} Hours
              </div>
              <div className="mt-2.5 flex justify-between gap-1">
                {data.hourly.map((h, i) => {
                  const showRain = h.precipPct >= 20;
                  return (
                    <div
                      key={`${i}-${h.time}`}
                      className="flex flex-1 flex-col items-center gap-1"
                    >
                      <div className="text-[10px] text-court-fg-muted">
                        {i === 0 ? "Now" : formatHour(h.time)}
                      </div>
                      <WeatherIcon
                        code={h.code}
                        isDay={isHourDay(h.time)}
                        sizeClass="h-4 w-4"
                      />
                      <div className="text-xs font-medium tabular-nums text-court-fg">
                        {Math.round(h.tempF)}°
                      </div>
                      <div
                        className={cn(
                          "h-3 text-[10px] tabular-nums",
                          showRain
                            ? "text-court-accent"
                            : "text-court-fg-muted/40",
                        )}
                      >
                        {h.precipPct}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* DAILY — forecast tiles always render the daytime icon
              since each row represents a whole day, not a moment.
              Header row labels the columns (RAIN / HIGH / LOW) so
              the temps and precip aren't a guess on first glance. */}
          {data.daily.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-court-fg-muted">
                {data.daily.length}-Day Forecast
              </div>
              {/* Column headers — widths mirror the data row below so
                  labels sit directly over their values. */}
              <div className="mt-2 flex items-center gap-2 border-b border-court-border-soft pb-1.5 text-[9px] font-semibold uppercase tracking-wider text-court-fg-muted">
                <span className="w-12">Day</span>
                <span className="h-4 w-4" aria-hidden />
                <span className="w-10">Rain</span>
                <span className="ml-auto">High</span>
                <span className="w-8 text-right">Low</span>
              </div>
              <ul className="flex flex-col">
                {data.daily.map((d, i) => {
                  const showRain = d.precipPctMax >= 20;
                  return (
                    <li
                      key={`${i}-${d.date}`}
                      className="flex items-center gap-2 py-1.5 text-xs"
                    >
                      <span className="w-12 text-court-fg-muted">
                        {formatDayShort(d.date, i)}
                      </span>
                      <WeatherIcon
                        code={d.code}
                        isDay={true}
                        sizeClass="h-4 w-4"
                      />
                      <span
                        className={cn(
                          "w-10 tabular-nums",
                          showRain
                            ? "text-court-accent"
                            : "text-court-fg-muted/50",
                        )}
                      >
                        {d.precipPctMax}%
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
