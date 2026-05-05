"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Shared state for the Game Plan Phase 2 Find Matches panel. Hoisted
// to the application shell (Providers) so the panel survives
// navigation between job and client pages — same trick the floating
// thread window uses. The button on each Game Plan surface calls
// open() with a target; the portal-rendered FindMatchesPanel
// subscribes to this context.

export type MatchTarget =
  | { kind: "job"; jobId: string; label: string; jobRfId: number | null }
  | { kind: "client"; clientId: string; label: string };

// Open jobs at the client are returned from the /api/game-plan/find-
// matches endpoint alongside the ranked candidates so the panel's
// per-card "pick a job" dropdown doesn't need a second round trip.
export type ClientOpenJob = {
  jobId: string;
  jobRfId: number | null;
  title: string;
};

export type MatchPosition = { x: number; y: number };
export type MatchSize = { w: number; h: number };

export const FIND_MATCHES_MIN_W = 420;
export const FIND_MATCHES_MIN_H = 460;
const DEFAULT_W = 540;
const DEFAULT_H = 640;

type Ctx = {
  target: MatchTarget | null;
  position: MatchPosition | null;
  size: MatchSize;
  minimized: boolean;
  open: (next: MatchTarget) => void;
  close: () => void;
  setPosition: (next: MatchPosition) => void;
  setSize: (next: MatchSize) => void;
  setMinimized: (next: boolean) => void;
};

const Context = createContext<Ctx | null>(null);

export function FindMatchesProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<MatchTarget | null>(null);
  const [position, setPositionState] = useState<MatchPosition | null>(null);
  const [size, setSizeState] = useState<MatchSize>({ w: DEFAULT_W, h: DEFAULT_H });
  const [minimized, setMinimizedState] = useState(false);

  const open = useCallback((next: MatchTarget) => {
    if (typeof window !== "undefined") {
      setPositionState((prev) => {
        if (prev) return prev;
        const cx = Math.max(20, window.innerWidth - DEFAULT_W - 32);
        const cy = Math.max(80, (window.innerHeight - DEFAULT_H) / 2);
        return { x: cx, y: cy };
      });
    }
    setTarget(next);
    setMinimizedState(false);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setMinimizedState(false);
  }, []);

  const setPosition = useCallback((next: MatchPosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: MatchSize) => {
    setSizeState({
      w: Math.max(FIND_MATCHES_MIN_W, next.w),
      h: Math.max(FIND_MATCHES_MIN_H, next.h),
    });
  }, []);

  const setMinimized = useCallback((next: boolean) => {
    setMinimizedState(next);
  }, []);

  return (
    <Context.Provider
      value={{ target, position, size, minimized, open, close, setPosition, setSize, setMinimized }}
    >
      {children}
    </Context.Provider>
  );
}

export function useFindMatches(): Ctx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useFindMatches must be used inside FindMatchesProvider");
  }
  return ctx;
}
