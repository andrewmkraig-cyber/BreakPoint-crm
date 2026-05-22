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
// to Chagrin Falls, OH so the chip always renders. The recruiter caught
// it disappearing whenever the browser revoked the permission, and an
// empty topbar slot looked like a regression. A fixed fallback also
// keeps desktop and mobile showing the same place when GPS is off.

const REFRESH_MS = 30 * 60 * 1000;
const HOURS_AHEAD = 6;
const DAYS_AHEAD = 7;
// Chagrin Falls, OH - used when the browser hasn't granted geolocation
// so weather still renders, and so desktop and mobile show the same
// location when GPS isn't in use.
const FALLBACK_LAT = 41.4312;
const FALLBACK_LON = -81.3901;

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

// Open-Meteo follows the WMO 4677 weather-code chart. We use a single
// source-of-truth dispatch (`bucketFor`) keyed on `code`, then derive
// icon / color / description off that bucket. The previous version
// kept three near-identical range checks in iconFor / colorFor /
// descriptionFor which could (and did) drift — once a code matched a
// rain bucket in iconFor but a default Cloud bucket in colorFor and
// you'd see a CloudRain icon tinted muted-grey instead of blue.
//
// Codes covered:
//   0, 1     — clear / mainly clear
//   2        — partly cloudy (2-tone glyph branch in WeatherIcon)
//   3        — overcast
//   45, 48   — fog / depositing rime fog
//   51,53,55 — drizzle (light / moderate / dense)
//   56, 57   — freezing drizzle
//   61,63,65 — rain (slight / moderate / heavy)
//   66, 67   — freezing rain
//   71,73,75 — snowfall (slight / moderate / heavy)
//   77       — snow grains
//   80,81,82 — rain showers (slight / moderate / violent)
//   85, 86   — snow showers
//   95       — thunderstorm
//   96, 99   — thunderstorm with hail
//
// Anything outside this set lands in the `unknown` bucket and emits a
// console warning so we notice if Open-Meteo expands the chart.
type WeatherBucket =
  | "clear"
  | "partly_cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "freezing_drizzle"
  | "rain"
  | "freezing_rain"
  | "snow"
  | "snow_grains"
  | "rain_showers"
  | "snow_showers"
  | "thunderstorm"
  | "thunder_hail"
  | "unknown";

function bucketFor(code: number): WeatherBucket {
  switch (code) {
    case 0:
    case 1:
      return "clear";
    case 2:
      return "partly_cloudy";
    case 3:
      return "overcast";
    case 45:
    case 48:
      return "fog";
    case 51:
    case 53:
    case 55:
      return "drizzle";
    case 56:
    case 57:
      return "freezing_drizzle";
    case 61:
    case 63:
    case 65:
      return "rain";
    case 66:
    case 67:
      return "freezing_rain";
    case 71:
    case 73:
    case 75:
      return "snow";
    case 77:
      return "snow_grains";
    case 80:
    case 81:
    case 82:
      return "rain_showers";
    case 85:
    case 86:
      return "snow_showers";
    case 95:
      return "thunderstorm";
    case 96:
    case 99:
      return "thunder_hail";
    default:
      console.warn("[weather] unmapped WMO code", code);
      return "unknown";
  }
}

function iconFor(code: number, isDay: boolean): LucideIcon {
  switch (bucketFor(code)) {
    case "clear":
      return isDay ? Sun : Moon;
    // Partly-cloudy renders via the 2-tone glyph in WeatherIcon; the
    // Cloud fallback here only fires if iconFor is called directly
    // (defensive — keeps the function complete on its own).
    case "partly_cloudy":
    case "overcast":
    case "fog":
      return Cloud;
    case "drizzle":
    case "freezing_drizzle":
    case "rain":
    case "freezing_rain":
    case "rain_showers":
      return CloudRain;
    case "snow":
    case "snow_grains":
    case "snow_showers":
      return CloudSnow;
    case "thunderstorm":
    case "thunder_hail":
      return CloudLightning;
    case "unknown":
    default:
      return Cloud;
  }
}

// Tailwind tint per bucket. Single source of truth keeps icon + color
// in sync — previously the range checks in iconFor and colorFor could
// drift and we'd render a CloudRain glyph in muted-grey or a Sun in
// sky-blue. Code 2 (partly cloudy) bypasses this entirely and renders
// the 2-tone PartlyCloudy{Day,Night}Icon glyphs.
function colorFor(code: number, isDay: boolean): string {
  switch (bucketFor(code)) {
    case "clear":
      return isDay ? "text-amber-400" : "text-slate-300";
    case "partly_cloudy":
    case "overcast":
    case "fog":
      return "text-court-fg-muted";
    case "drizzle":
    case "freezing_drizzle":
    case "rain":
    case "freezing_rain":
    case "rain_showers":
      return "text-blue-500";
    case "snow":
    case "snow_grains":
    case "snow_showers":
      return "text-sky-300";
    case "thunderstorm":
    case "thunder_hail":
      return "text-purple-500";
    case "unknown":
    default:
      return "text-court-fg-muted";
  }
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
  // 0 vs 1 distinction is preserved (Clear vs Mainly Clear) since
  // bucketFor collapses both into "clear" — the human-readable label
  // benefits from the finer split.
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly Clear";
  switch (bucketFor(code)) {
    case "clear":
      return "Clear";
    case "partly_cloudy":
      return "Partly Cloudy";
    case "overcast":
      return "Overcast";
    case "fog":
      return "Foggy";
    case "drizzle":
      return "Drizzle";
    case "freezing_drizzle":
      return "Freezing Drizzle";
    case "rain":
      return "Rainy";
    case "freezing_rain":
      return "Freezing Rain";
    case "snow":
      return "Snowy";
    case "snow_grains":
      return "Snow Grains";
    case "rain_showers":
      return "Rain Showers";
    case "snow_showers":
      return "Snow Showers";
    case "thunderstorm":
      return "Thunderstorm";
    case "thunder_hail":
      return "Thunder & Hail";
    case "unknown":
    default:
      return "Unknown";
  }
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

// Reverse-geocode lat/lon into a "City, ST" label using BigDataCloud's
// keyless client endpoint. CORS-enabled, no auth needed, fine for an
// internal single-user dashboard. Returns null on any failure so the
// popover can fall back to a generic header.
async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<string | null> {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivisionCode?: string;
      principalSubdivision?: string;
      countryCode?: string;
      countryName?: string;
    };
    const city = json.city || json.locality;
    // principalSubdivisionCode is "US-OH" — slice the state portion for
    // a "City, OH" label. Fall back to the long subdivision name.
    let region = "";
    if (
      json.principalSubdivisionCode &&
      json.principalSubdivisionCode.includes("-")
    ) {
      region = json.principalSubdivisionCode.split("-")[1] ?? "";
    } else if (json.principalSubdivision) {
      region = json.principalSubdivision;
    }
    if (city && region) return `${city}, ${region}`;
    if (city && json.countryCode) return `${city}, ${json.countryCode}`;
    if (city) return city;
    return null;
  } catch {
    return null;
  }
}

export function WeatherWidget() {
  const [data, setData] = useState<Weather | null>(null);
  const [location, setLocation] = useState<string | null>(null);
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
        const tempF = json.current?.temperature_2m;
        const apparentF = json.current?.apparent_temperature;
        const code = json.current?.weather_code;
        // Focused log so the raw weathercode is easy to spot in the
        // browser console — useful when the displayed condition looks
        // wrong and we need to confirm what Open-Meteo actually
        // returned. Logs the dispatch decision alongside the code so
        // mismatches between API and our mapping show up at a glance.
        console.log("[weather] current weathercode:", code, {
          bucket: typeof code === "number" ? bucketFor(code) : "(no code)",
          description:
            typeof code === "number" ? descriptionFor(code) : "(no code)",
          hourlyCodes: (json.hourly?.weather_code ?? []).slice(0, 6),
          dailyCodes: (json.daily?.weather_code ?? []).slice(0, 7),
        });
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
      // Resolve the lat/lon into a human label for the popover header.
      // Fallback source already has a known label so we skip the
      // network call to keep the popover header stable on permission
      // denial.
      if (source === "geolocation") {
        void reverseGeocode(lat, lon).then((label) => {
          if (cancelled) return;
          if (label) setLocation(label);
          else setLocation("Your Location");
        });
      } else {
        setLocation("Chagrin Falls, OH");
      }
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
            "[weather] geolocation denied or failed, using Chagrin Falls fallback",
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
        className="inline-flex cursor-default items-center gap-1.5 rounded-lg border border-court-border bg-court-surface-subtle px-2.5 py-1.5 text-court-fg shadow-sm"
        aria-label={`Current temperature ${rounded} degrees Fahrenheit`}
      >
        <WeatherIcon
          code={data.code}
          isDay={data.isCurrentDay}
          sizeClass="h-5 w-5"
        />
        {/* Hide the temp text on sub-360px viewports (Galaxy Fold
            closed, iPhone 5/SE-era) so the topbar's icon row doesn't
            wrap — at ≥360px it's back. The WeatherIcon to the left
            still conveys the conditions on its own. Sized to text-sm so
            the chip sits at the same visual weight as the icon buttons
            and avatar rather than dominating the row. */}
        <span className="hidden min-[360px]:inline text-sm font-semibold tabular-nums">{rounded}°</span>
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
          {/* HEADER — location (reverse-geocoded from current
              coordinates) on the left, today's full date on the right.
              Pulling the date up here frees the row below so the
              "(feels XX°)" sub-line sits inline with the temperature
              instead of wrapping. */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-court-fg">
              {location ?? "Locating…"}
            </span>
            <span className="text-[10px] text-court-fg-muted">
              {formatTodayLong()}
            </span>
          </div>

          {/* CURRENT — icon + temp on the left, "(feels XX°)" forced on
              the same line as the temperature so the row reads as one
              piece of data. */}
          <div className="mt-2 flex items-center gap-2.5">
            <WeatherIcon
              code={data.code}
              isDay={data.isCurrentDay}
              sizeClass="h-9 w-9"
            />
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
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
