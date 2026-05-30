"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  setAutoNightMode as persistAutoNightMode,
  setCourtMode as persistCourtMode,
} from "@/app/settings/appearance-actions";

// Court Mode is now two orthogonal axes:
//   surface: "hard" | "clay" | "grass"   ← which palette family
//   theme:   "light" | "dark"            ← which intensity
//
// Both axes mirror onto <html> as data attributes:
//   <html data-surface="hard" data-theme="light">
// CSS in globals.css keys off those attributes for the 6 palette
// blocks; Tailwind's `dark:`, `clay:`, `grass:`, `hard:` variants
// are wired to match (see tailwind.config.ts).
//
// Pre-Ace-25 storage used a single "courtMode" key with values
// "hard" | "clay" | "grass" where clay meant dark-slate and grass
// meant dark-green. We migrate that one-shot on load to the two-key
// scheme then drop the legacy key.

// Night Court honors data-theme like every other surface as of
// Ace 39+: light = near-black sidebar slab with white-w/-green-tint
// cards (Night Light), dark = the original charcoal-and-graphite
// palette (Night Dark). globals.css carries separate token blocks
// for each pair.
export type CourtSurface = "hard" | "clay" | "grass" | "night";
export type CourtTheme = "light" | "dark";

const SURFACES: readonly CourtSurface[] = ["hard", "clay", "grass", "night"] as const;
const THEMES: readonly CourtTheme[] = ["light", "dark"] as const;

const SURFACE_KEY = "ace-court-surface";
const THEME_KEY = "ace-court-theme";
const LEGACY_KEY = "courtMode";

// Auto Night Mode. When enabled (preference stored on UserProfile, seeded
// in via initialAutoNightMode) the client flips the active surface to its
// dark variant at 7:00 PM ET and back to light at 7:00 AM ET. Checked on
// a 1-minute interval client-side - no cron. The window marker below is
// per-device bookkeeping (localStorage, not a preference): it records the
// last day/night window we auto-applied so a theme the recruiter changes
// by hand inside a window survives until the next 7 AM / 7 PM boundary.
const AUTO_NIGHT_WINDOW_KEY = "ace-auto-night-window";
const NIGHT_START_HOUR = 19; // 7:00 PM ET
const DAY_START_HOUR = 7; // 7:00 AM ET

// Current day/night window in America/New_York plus the theme it expects.
// `key` is stable for the whole window and changes exactly at each
// boundary, so we apply the auto theme once per crossing. Intl with an
// IANA zone tracks US Eastern DST automatically, so 7 PM / 7 AM ET stay
// correct year round regardless of the device's own timezone.
function currentNightWindow(now: Date = new Date()): {
  key: string;
  theme: CourtTheme;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24; // some engines emit "24" at midnight
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`;
  const isNight = hour >= NIGHT_START_HOUR || hour < DAY_START_HOUR;
  // Anchor the night window to the ET date its 7 PM trigger fired on so
  // the span that crosses midnight keeps a single key. Before 7 AM that
  // trigger was the previous ET calendar day.
  let anchorDate = dateStr;
  if (isNight && hour < DAY_START_HOUR) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    anchorDate = d.toISOString().slice(0, 10);
  }
  return {
    key: `${isNight ? "night" : "day"}:${anchorDate}`,
    theme: isNight ? "dark" : "light",
  };
}

type CourtModeContextShape = {
  surface: CourtSurface;
  theme: CourtTheme;
  setSurface: (next: CourtSurface) => void;
  setTheme: (next: CourtTheme) => void;
  toggleTheme: () => void;
  autoNightMode: boolean;
  setAutoNightMode: (next: boolean) => void;
};

const CourtModeContext = createContext<CourtModeContextShape | null>(null);

function isSurface(v: string | null): v is CourtSurface {
  return v !== null && (SURFACES as readonly string[]).includes(v);
}
function isTheme(v: string | null): v is CourtTheme {
  return v !== null && (THEMES as readonly string[]).includes(v);
}

// Migration: legacy "courtMode" key carried surface AND theme jammed
// into one slot — clay/grass meant dark, hard meant light. Pull what
// we can and write the new keys, then delete the old one so this
// runs at most once per browser.
function migrateLegacyStorage(): { surface: CourtSurface; theme: CourtTheme } | null {
  if (typeof window === "undefined") return null;
  try {
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    let surface: CourtSurface = "hard";
    let theme: CourtTheme = "light";
    if (legacy === "clay") {
      // Old "clay" was dark-slate; closest match in the new vocab is
      // hard-dark (US Open blue). Keep clay-as-clay but flip theme.
      surface = "clay";
      theme = "dark";
    } else if (legacy === "grass") {
      surface = "grass";
      theme = "dark";
    } else if (legacy === "hard") {
      surface = "hard";
      theme = "light";
    }
    window.localStorage.setItem(SURFACE_KEY, surface);
    window.localStorage.setItem(THEME_KEY, theme);
    window.localStorage.removeItem(LEGACY_KEY);
    return { surface, theme };
  } catch {
    return null;
  }
}

// `fallback` carries the DB-backed UserProfile surface/theme (seeded from
// the server). When localStorage is missing a key - the normal state after
// an iOS PWA eviction - we fall back to the durable DB value instead of
// snapping to Hard/Light, which is what made dark mode "forget" on a hard
// close. The reconciliation effect then re-writes localStorage from the
// restored value so subsequent reads are fast again.
function readStored(fallback: {
  surface: CourtSurface;
  theme: CourtTheme;
}): { surface: CourtSurface; theme: CourtTheme } {
  if (typeof window === "undefined") return fallback;
  try {
    const migrated = migrateLegacyStorage();
    if (migrated) return migrated;
    const s = window.localStorage.getItem(SURFACE_KEY);
    const t = window.localStorage.getItem(THEME_KEY);
    return {
      surface: isSurface(s) ? s : fallback.surface,
      theme: isTheme(t) ? t : fallback.theme,
    };
  } catch {
    return fallback;
  }
}

function applyToHtml(surface: CourtSurface, theme: CourtTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-surface", surface);
  root.setAttribute("data-theme", theme);
  // Strip legacy classes so old `.dark` / `.grass` selectors can't
  // collide with the new attribute-driven CSS.
  root.classList.remove("dark", "grass");
  root.removeAttribute("data-court-mode");
}

export function CourtModeProvider({
  children,
  initialAutoNightMode = false,
  initialSurface,
  initialTheme,
}: {
  children: ReactNode;
  // Seeded from the signed-in user's UserProfile in layout.tsx so the
  // preference is correct on first paint and follows the user across
  // devices. Defaults false for the unauthenticated /sign-in surface.
  initialAutoNightMode?: boolean;
  // DB-backed Court Mode surface/theme (UserProfile.courtSurface/courtTheme),
  // also seeded from layout.tsx. These are the durable source of truth used
  // to repopulate the palette when localStorage was evicted on a PWA hard
  // close. Strings (not the unions) because they arrive raw from the DB;
  // validated to the defaults here.
  initialSurface?: string;
  initialTheme?: string;
}) {
  const seedSurface: CourtSurface = isSurface(initialSurface ?? null)
    ? (initialSurface as CourtSurface)
    : "hard";
  const seedTheme: CourtTheme = isTheme(initialTheme ?? null)
    ? (initialTheme as CourtTheme)
    : "light";
  // Seed from the DB values so the SSR HTML and the first client render
  // agree (both run with the same server-read props). The pre-hydration
  // script in layout.tsx has already stamped the real values onto <html>;
  // the mount effect below reconciles against localStorage right after.
  const [surface, setSurfaceState] = useState<CourtSurface>(seedSurface);
  const [theme, setThemeState] = useState<CourtTheme>(seedTheme);
  const [autoNightMode, setAutoNightModeState] = useState<boolean>(
    initialAutoNightMode,
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStored({ surface: seedSurface, theme: seedTheme });
    setSurfaceState(stored.surface);
    setThemeState(stored.theme);
    setHydrated(true);
    // seedSurface/seedTheme derive from stable props; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconciliation: keep <html> + storage in sync whenever state
  // changes post-hydration. The setters below also mutate directly
  // for click-time responsiveness; this effect is defense-in-depth.
  useEffect(() => {
    if (!hydrated) return;
    applyToHtml(surface, theme);
    try {
      window.localStorage.setItem(SURFACE_KEY, surface);
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage disabled — in-memory state is still correct for this session.
    }
  }, [hydrated, surface, theme]);

  // Cross-document Court Mode sync. The palette lives in localStorage, so
  // when the parent window toggles surface/theme the change must also reach
  // any same-origin iframe rendering Ace chrome — the candidates split-view
  // profile and the job Matches profile both embed /candidates/[id], which
  // mounts its own CourtModeProvider inside the iframe document. The
  // `storage` event fires in *other* same-origin documents, so each open
  // iframe re-reads the persisted values and re-stamps its own <html>. The
  // window that made the change already updated itself via the setters and
  // never receives its own event. Re-stamps the DOM directly (no setState,
  // no write-back) so it can't echo another storage event and loop between
  // documents.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== SURFACE_KEY && e.key !== THEME_KEY) return;
      const stored = readStored({ surface: seedSurface, theme: seedTheme });
      applyToHtml(stored.surface, stored.theme);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSurface = useCallback((next: CourtSurface) => {
    setSurfaceState(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-surface", next);
    }
    try {
      window.localStorage.setItem(SURFACE_KEY, next);
    } catch {}
    // Durable copy on UserProfile so the palette survives a localStorage
    // eviction and follows the user across devices. Fire-and-forget.
    void persistCourtMode({ surface: next }).catch(() => {});
  }, []);

  const setTheme = useCallback((next: CourtTheme) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {}
    void persistCourtMode({ theme: next }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: CourtTheme = prev === "light" ? "dark" : "light";
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", next);
      }
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {}
      void persistCourtMode({ theme: next }).catch(() => {});
      return next;
    });
  }, []);

  const setAutoNightMode = useCallback(
    (next: boolean) => {
      setAutoNightModeState(next);
      // Persist to the profile so the preference follows the user across
      // devices. Fire-and-forget: this session's behavior is already
      // correct even if the network write lags or fails.
      void persistAutoNightMode(next).catch(() => {});
      if (next) {
        // Snap to the current window's theme right away and seed the
        // window marker so the interval doesn't immediately re-apply.
        const { key, theme: expected } = currentNightWindow();
        setTheme(expected);
        try {
          window.localStorage.setItem(AUTO_NIGHT_WINDOW_KEY, key);
        } catch {}
      } else {
        // Forget the marker so a later re-enable applies the current
        // window immediately instead of assuming it already ran.
        try {
          window.localStorage.removeItem(AUTO_NIGHT_WINDOW_KEY);
        } catch {}
      }
    },
    [setTheme],
  );

  // Auto Night Mode driver. Runs only while enabled. Each tick (and once
  // on mount) compares the current ET day/night window against the last
  // window we auto-applied: on a boundary crossing it flips the theme and
  // records the new window; inside a window it does nothing, so a manual
  // Light/Dark switch the recruiter makes stands until the next 7 AM /
  // 7 PM ET trigger. The 1-minute cadence also catches boundaries that
  // elapsed while Ace was closed - the first tick after reopening flips.
  useEffect(() => {
    if (!hydrated || !autoNightMode) return;
    const tick = () => {
      const { key, theme: expected } = currentNightWindow();
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(AUTO_NIGHT_WINDOW_KEY);
      } catch {}
      if (last !== key) {
        setTheme(expected);
        try {
          window.localStorage.setItem(AUTO_NIGHT_WINDOW_KEY, key);
        } catch {}
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [hydrated, autoNightMode, setTheme]);

  return (
    <CourtModeContext.Provider
      value={{
        surface,
        theme,
        setSurface,
        setTheme,
        toggleTheme,
        autoNightMode,
        setAutoNightMode,
      }}
    >
      {children}
    </CourtModeContext.Provider>
  );
}

export function useCourtMode(): CourtModeContextShape {
  const ctx = useContext(CourtModeContext);
  if (!ctx) {
    throw new Error("useCourtMode must be used inside a CourtModeProvider");
  }
  return ctx;
}

// Pre-hydration inline-script body. Reads localStorage and stamps
// data-surface + data-theme onto <html> before React hydrates so the
// first paint matches the persisted palette — no flash. Also handles
// the legacy "courtMode" migration inline so the very first render
// after the upgrade reads correctly.
//
// `fallbackSurface` / `fallbackTheme` are the DB-backed UserProfile values
// passed in from layout.tsx (a server component). When localStorage is empty
// - the normal state after an iOS PWA evicts it on a hard close - the script
// stamps the DB value instead of defaulting to Hard/Light, AND re-seeds
// localStorage from it so the rest of the app reads the right palette without
// a flash. This is what makes dark mode + the chosen surface survive a hard
// close. The fallbacks are validated server-side, so the only values that can
// be interpolated are the known enum strings (no injection surface).
export function buildCourtModePreHydrationScript(
  fallbackSurface?: string,
  fallbackTheme?: string,
): string {
  const fs = isSurface(fallbackSurface ?? null) ? fallbackSurface : "hard";
  const ft = isTheme(fallbackTheme ?? null) ? fallbackTheme : "light";
  return `
(function(){try{var ls=window.localStorage;var legacy=ls.getItem('courtMode');var s,t;if(legacy){s=legacy==='clay'?'clay':legacy==='grass'?'grass':'hard';t=(legacy==='clay'||legacy==='grass')?'dark':'light';ls.setItem('ace-court-surface',s);ls.setItem('ace-court-theme',t);ls.removeItem('courtMode');}else{s=ls.getItem('ace-court-surface');t=ls.getItem('ace-court-theme');if(!s){s='${fs}';ls.setItem('ace-court-surface',s);}if(!t){t='${ft}';ls.setItem('ace-court-theme',t);}}if(['hard','clay','grass','night'].indexOf(s)<0)s='hard';if(['light','dark'].indexOf(t)<0)t='light';document.documentElement.setAttribute('data-surface',s);document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
`.trim();
}
