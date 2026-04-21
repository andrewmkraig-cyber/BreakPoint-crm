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

// Swap the managed classes on <html>. Kept in a separate fn so the inline
// pre-hydration script in layout.tsx can share the exact logic if we inline
// it there later to kill the first-paint flash.
function applyModeToHtml(mode: CourtMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const cls of MANAGED_CLASSES) root.classList.remove(cls);
  if (mode === "clay") root.classList.add("dark");
  else if (mode === "grass") root.classList.add("grass");
}

export function CourtModeProvider({ children }: { children: ReactNode }) {
  // Seed with "hard" so server-render and first client render agree. We
  // reconcile to the real stored value in the useEffect below. If a
  // pre-hydration script (injected by layout.tsx) already flipped the class,
  // this provider's effect will confirm + keep it in sync with state.
  const [mode, setModeState] = useState<CourtMode>("hard");

  useEffect(() => {
    const stored = readStoredMode();
    setModeState(stored);
    applyModeToHtml(stored);
  }, []);

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
(function(){try{var m=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(m==="clay"){document.documentElement.classList.add("dark");}else if(m==="grass"){document.documentElement.classList.add("grass");}}catch(e){}})();
`.trim();
