"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Shared state for the Game Plan Phase 2 Find Matches panel. Hoisted
// to the application shell (Providers) so the panel survives
// navigation between job and client pages — same trick the floating
// thread window uses. The button on each Game Plan surface calls
// open() with a target; the portal-rendered FindMatchesPanel
// subscribes to this context.
//
// Per-entity caching: every (kind, id) pair owns its own results
// cache so switching from Job A to Job B doesn't leak A's matches
// into B's panel. The cache is intentionally cleared on close() for
// the active entity — re-opening a previously-closed entity runs a
// fresh search. Switching to a different entity (without closing)
// preserves the prior entity's cache so toggling back restores
// without a re-fetch.

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

export type Match = {
  candidateId: string;
  candidateRfId: number | null;
  name: string;
  title: string;
  currentEmployer: string;
  location: string;
  comp: string;
  rationale: string;
  score: number;
};

export type CachedFetchState = {
  matches: Match[];
  hasMore: boolean;
  nextPage: number;
  openJobs: ClientOpenJob[];
};

export type MatchPosition = { x: number; y: number };
export type MatchSize = { w: number; h: number };

export const FIND_MATCHES_MIN_W = 420;
export const FIND_MATCHES_MIN_H = 460;
const DEFAULT_W = 540;
const DEFAULT_H = 640;

export function targetKey(target: MatchTarget): string {
  return target.kind === "job"
    ? `job:${target.jobId}`
    : `client:${target.clientId}`;
}

type Ctx = {
  target: MatchTarget | null;
  position: MatchPosition | null;
  size: MatchSize;
  minimized: boolean;
  open: (next: MatchTarget) => void;
  // Closes the panel AND clears the cache for the entity it was
  // showing. Re-opening that same entity later runs a fresh search.
  close: () => void;
  setPosition: (next: MatchPosition) => void;
  setSize: (next: MatchSize) => void;
  setMinimized: (next: boolean) => void;
  // Cache reads + writes used by the panel. `bumpCacheTick` triggers
  // a re-render so the panel re-reads the cache after a fetch.
  getCachedFor: (target: MatchTarget) => CachedFetchState | null;
  setCachedFor: (target: MatchTarget, state: CachedFetchState) => void;
  cacheTick: number;
};

const Context = createContext<Ctx | null>(null);

export function FindMatchesProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<MatchTarget | null>(null);
  const [position, setPositionState] = useState<MatchPosition | null>(null);
  const [size, setSizeState] = useState<MatchSize>({ w: DEFAULT_W, h: DEFAULT_H });
  const [minimized, setMinimizedState] = useState(false);

  // Cache lives in a ref so writes don't recreate every reader;
  // cacheTick state lets the panel re-render when a cache slot is
  // populated. Map keyed by `${kind}:${id}` so two open entities
  // can coexist without trampling each other.
  const cacheRef = useRef<Map<string, CachedFetchState>>(new Map());
  const [cacheTick, setCacheTick] = useState(0);

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
    // Clear the active entity's cache so re-opening it runs fresh.
    // Other entities' caches stay intact (so toggling between
    // already-searched entities within the same session is
    // instant).
    setTarget((current) => {
      if (current) cacheRef.current.delete(targetKey(current));
      return null;
    });
    setMinimizedState(false);
    setCacheTick((n) => n + 1);
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

  const getCachedFor = useCallback(
    (t: MatchTarget): CachedFetchState | null => {
      return cacheRef.current.get(targetKey(t)) ?? null;
    },
    [],
  );

  const setCachedFor = useCallback((t: MatchTarget, state: CachedFetchState) => {
    cacheRef.current.set(targetKey(t), state);
    setCacheTick((n) => n + 1);
  }, []);

  return (
    <Context.Provider
      value={{
        target,
        position,
        size,
        minimized,
        open,
        close,
        setPosition,
        setSize,
        setMinimized,
        getCachedFor,
        setCachedFor,
        cacheTick,
      }}
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
