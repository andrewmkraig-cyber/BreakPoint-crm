"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// Three surfaces: "hard" = default / light, "clay" = dark, "grass" = BreakPoint
// green. The selector value persists to localStorage and is mirrored onto
// <html> as a class that Tailwind's dark: and grass: variants key off of.
//
// Class map:
//   hard  → no extra class on <html> (bare default palette)
//   clay  → `.dark`  — reuses Tailwind's built-in `darkMode: "class"` setup
//   grass → `.grass` — custom variant registered in tailwind.config.ts
//
// For infrastructure this file wires the mechanism only — no component in the
// repo carries dark:/grass: variants yet, so toggling between modes today
// will flip the <html> class but not visibly change anything. That's
// deliberate: the theming sweep lands incrementally, one surface at a time.

export type CourtMode = "hard" | "clay" | "grass";

const COURT_MODES: readonly CourtMode[] = ["hard", "clay", "grass"] as const;
const STORAGE_KEY = "courtMode";
const MANAGED_CLASSES = ["dark", "grass"] as const;

type CourtModeContextShape = {
  mode: CourtMode;
  setMode: (next: CourtMode) => void;
};

const CourtModeContext = createContext<CourtModeContextShape | null>(null);

// Read the stored value defensively: localStorage might be unavailable
// (SSR / private browsing) and the stored string might not be a valid
// CourtMode if a user hand-edited it or a future version changed the
// vocab. Fall back to "hard" in either case.
function readStoredMode(): CourtMode {
  if (typeof window === "undefined") return "hard";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (COURT_MODES as readonly string[]).includes(raw)) {
      return raw as CourtMode;
    }
  } catch {
    // Storage disabled — accept default.
  }
  return "hard";
}

// Swap the managed classes on <html>. Also stamps a `data-court-mode`
// attribute so DevTools inspection is unambiguous: a Clay-mode <html> reads
// `<html class="… dark" data-court-mode="clay">` — no guessing whether
// some other `.dark` class elsewhere is responsible.
function applyModeToHtml(mode: CourtMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cls of MANAGED_CLASSES) root.classList.remove(cls);
  if (mode === "clay") root.classList.add("dark");
  else if (mode === "grass") root.classList.add("grass");
  root.setAttribute("data-court-mode", mode);
}

export function CourtModeProvider({ children }: { children: ReactNode }) {
  // Seed with "hard" so the server-rendered HTML matches the first client
  // render (no hydration mismatch). The real stored value lands via the
  // hydration effect below, which then drives the DOM-sync effect.
  const [mode, setModeState] = useState<CourtMode>("hard");
  // Gate on hydration so the first render doesn't clobber the class that
  // the pre-hydration script already stamped onto <html>. Without this, the
  // mount-time "hard" state would briefly reset .dark / .grass before
  // useEffect could read localStorage and put it back — a visible flash.
  const [hydrated, setHydrated] = useState(false);

  // Mount-only: pull the persisted mode and hand control to the sync
  // effect below.
  useEffect(() => {
    setModeState(readStoredMode());
    setHydrated(true);
  }, []);

  // Reconciliation effect: runs whenever state changes post-hydration. The
  // click handler also mutates the DOM directly (see setMode below), so this
  // is defense-in-depth — ensures the DOM stays in sync even if effects are
  // ever skipped or batched oddly.
  useEffect(() => {
    if (!hydrated) return;
    applyModeToHtml(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage disabled — in-memory state is still correct for this session.
    }
  }, [hydrated, mode]);

  // Click handler: mutate state AND mutate the DOM + storage synchronously.
  // Earlier this function only called setModeState, relying on the effect
  // above to reflect it to the DOM. That's correct in principle, but it
  // routes a click-time side-effect through React's scheduler, and any
  // weirdness there (Strict Mode double-invoke, batched state updates that
  // fire effects out of order, an early-returning effect that missed a
  // prior render) silently swallows the visual change. Doing the DOM mutate
  // here as well is idempotent — the reconciliation effect will no-op on
  // re-apply — and makes clicks unconditionally produce a <html> class
  // change, which is what the Court Mode selector is meant to do.
  const setMode = useCallback((next: CourtMode) => {
    setModeState(next);
    applyModeToHtml(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage disabled — in-memory state is still correct for this session.
    }
  }, []);

  return (
    <CourtModeContext.Provider value={{ mode, setMode }}>
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

// Small inline script body that picks up the stored mode before React
// hydrates and stamps the right class on <html>, preventing a flash of
// unthemed content. Exported as a string so layout.tsx can drop it into
// a <script dangerouslySetInnerHTML> right at the top of <body>.
export const COURT_MODE_PRE_HYDRATION_SCRIPT = `
(function(){try{var m=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var r=document.documentElement;if(m==="clay"){r.classList.add("dark");r.setAttribute("data-court-mode","clay");}else if(m==="grass"){r.classList.add("grass");r.setAttribute("data-court-mode","grass");}else{r.setAttribute("data-court-mode","hard");}}catch(e){}})();
`.trim();
