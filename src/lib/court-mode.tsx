"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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

type CourtModeContextShape = {
  surface: CourtSurface;
  theme: CourtTheme;
  setSurface: (next: CourtSurface) => void;
  setTheme: (next: CourtTheme) => void;
  toggleTheme: () => void;
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

function readStored(): { surface: CourtSurface; theme: CourtTheme } {
  if (typeof window === "undefined") return { surface: "hard", theme: "light" };
  try {
    const migrated = migrateLegacyStorage();
    if (migrated) return migrated;
    const s = window.localStorage.getItem(SURFACE_KEY);
    const t = window.localStorage.getItem(THEME_KEY);
    return {
      surface: isSurface(s) ? s : "hard",
      theme: isTheme(t) ? t : "light",
    };
  } catch {
    return { surface: "hard", theme: "light" };
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

export function CourtModeProvider({ children }: { children: ReactNode }) {
  // Seed defaults so the SSR HTML matches the first client render —
  // the pre-hydration script in layout.tsx has already stamped the
  // real values onto <html> by the time this provider mounts.
  const [surface, setSurfaceState] = useState<CourtSurface>("hard");
  const [theme, setThemeState] = useState<CourtTheme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setSurfaceState(stored.surface);
    setThemeState(stored.theme);
    setHydrated(true);
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

  const setSurface = useCallback((next: CourtSurface) => {
    setSurfaceState(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-surface", next);
    }
    try {
      window.localStorage.setItem(SURFACE_KEY, next);
    } catch {}
  }, []);

  const setTheme = useCallback((next: CourtTheme) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {}
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
      return next;
    });
  }, []);

  return (
    <CourtModeContext.Provider
      value={{ surface, theme, setSurface, setTheme, toggleTheme }}
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
export const COURT_MODE_PRE_HYDRATION_SCRIPT = `
(function(){try{var ls=window.localStorage;var legacy=ls.getItem('courtMode');var s,t;if(legacy){s=legacy==='clay'?'clay':legacy==='grass'?'grass':'hard';t=(legacy==='clay'||legacy==='grass')?'dark':'light';ls.setItem('ace-court-surface',s);ls.setItem('ace-court-theme',t);ls.removeItem('courtMode');}else{s=ls.getItem('ace-court-surface')||'hard';t=ls.getItem('ace-court-theme')||'light';}if(['hard','clay','grass','night'].indexOf(s)<0)s='hard';document.documentElement.setAttribute('data-surface',s);document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
`.trim();
