"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
// Route-aware render gate: each FindMatchesButton announces itself
// via useFindMatchesActiveRoute(target) on mount, which sets the
// provider's activeRouteKey. The panel only paints when
// activeRouteKey === a key that has been opened (openEntities
// contains it). Navigating to an entity that has never been opened
// hides the panel; navigating to a previously-opened entity
// auto-restores its cached results.

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

// Per-axis score breakdown returned alongside the headline score.
// Each field is one short sentence Claude writes per match; the
// panel renders them as labeled rows in the score popover. All
// fields can be empty strings when Claude couldn't ground the
// dimension (e.g. comp not on file) — the popover skips empties.
export type ScoreBreakdown = {
  titleMatch: string;
  locationFit: string;
  experienceFit: string;
  compensationFit: string;
  overallSummary: string;
};

export type Match = {
  candidateId: string;
  candidateRfId: number | null;
  name: string;
  // Split-name + email pulled through so the panel's Email action can
  // open the composer pre-addressed without a second round trip.
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  currentEmployer: string;
  location: string;
  comp: string;
  rationale: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
};

export type CachedFetchState = {
  matches: Match[];
  hasMore: boolean;
  nextPage: number;
  openJobs: ClientOpenJob[];
  // pickedJob is set on client targets where the recruiter picked a
  // specific job inside the panel. Null on direct job targets.
  pickedJob: ClientOpenJob | null;
  // Every candidate id the server has surfaced to this panel, plus
  // every id the recruiter dismissed. Sent back as excludeIds on
  // "Show 5 more" so neither pagination nor dismissed candidates
  // ever come back.
  excludeIds: string[];
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
  // The route entity currently visible to the user. Set by each
  // FindMatchesButton via useFindMatchesActiveRoute() on mount and
  // cleared on unmount, so navigating to a page without a button
  // resolves to null. The panel render gate compares this against
  // openEntities + the cache to decide whether to paint.
  activeRouteKey: string | null;
  setActiveRouteKey: (
    next: string | null | ((prev: string | null) => string | null),
  ) => void;
  // Set of entity keys that have an open panel. open() adds; close()
  // removes for the active route entity only.
  openEntities: Set<string>;
  // Targets keyed by `${kind}:${id}` so the panel can recover the
  // full MatchTarget object when rendering for the active route.
  targetForKey: (key: string) => MatchTarget | null;
  position: MatchPosition | null;
  size: MatchSize;
  minimized: boolean;
  open: (next: MatchTarget) => void;
  // Closes the panel for the currently-active route entity AND
  // clears its cache so re-opening that same entity later runs a
  // fresh search. Other entities' caches stay intact.
  close: () => void;
  setPosition: (next: MatchPosition) => void;
  setSize: (next: MatchSize) => void;
  setMinimized: (next: boolean) => void;
  // Cache reads + writes used by the panel.
  getCachedFor: (key: string) => CachedFetchState | null;
  setCachedFor: (key: string, state: CachedFetchState) => void;
  cacheTick: number;
  // Per-job tick counter incremented every time a Find Matches stream
  // finishes for that job and its CandidateMatch rows have been
  // upserted server-side. Listeners (like the /jobs/[id] Matched tab
  // badge) watch this tick to re-fetch their count without a full
  // page reload. Keyed on jobId, not the panel's targetKey, because
  // client-target streams resolve to a picked job and the job page
  // cares about the picked job — not the originating client.
  matchesSavedTick: Record<string, number>;
  notifyMatchesSaved: (jobId: string) => void;
};

const Context = createContext<Ctx | null>(null);

export function FindMatchesProvider({ children }: { children: ReactNode }) {
  const [activeRouteKey, setActiveRouteKeyState] = useState<string | null>(null);
  const [openEntities, setOpenEntities] = useState<Set<string>>(new Set());
  const [position, setPositionState] = useState<MatchPosition | null>(null);
  const [size, setSizeState] = useState<MatchSize>({ w: DEFAULT_W, h: DEFAULT_H });
  const [minimized, setMinimizedState] = useState(false);

  const cacheRef = useRef<Map<string, CachedFetchState>>(new Map());
  const targetsRef = useRef<Map<string, MatchTarget>>(new Map());
  const [cacheTick, setCacheTick] = useState(0);
  const [matchesSavedTick, setMatchesSavedTick] = useState<
    Record<string, number>
  >({});

  const setActiveRouteKey = useCallback(
    (next: string | null | ((prev: string | null) => string | null)) => {
      setActiveRouteKeyState((prev) =>
        typeof next === "function" ? (next as (p: string | null) => string | null)(prev) : next,
      );
    },
    [],
  );

  const open = useCallback((next: MatchTarget) => {
    if (typeof window !== "undefined") {
      setPositionState((prev) => {
        if (prev) return prev;
        const cx = Math.max(20, window.innerWidth - DEFAULT_W - 32);
        const cy = Math.max(80, (window.innerHeight - DEFAULT_H) / 2);
        return { x: cx, y: cy };
      });
    }
    const key = targetKey(next);
    targetsRef.current.set(key, next);
    setOpenEntities((prev) => {
      if (prev.has(key)) return prev;
      const copy = new Set(prev);
      copy.add(key);
      return copy;
    });
    setMinimizedState(false);
  }, []);

  const close = useCallback(() => {
    setActiveRouteKeyState((currentRoute) => {
      // Close only affects the entity currently in view. If the
      // active route key isn't set (somehow), bail without mutating
      // open state — the panel won't paint anyway.
      if (currentRoute) {
        cacheRef.current.delete(currentRoute);
        targetsRef.current.delete(currentRoute);
        setOpenEntities((prev) => {
          if (!prev.has(currentRoute)) return prev;
          const copy = new Set(prev);
          copy.delete(currentRoute);
          return copy;
        });
      }
      return currentRoute;
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

  const getCachedFor = useCallback((key: string): CachedFetchState | null => {
    return cacheRef.current.get(key) ?? null;
  }, []);

  const setCachedFor = useCallback((key: string, state: CachedFetchState) => {
    cacheRef.current.set(key, state);
    setCacheTick((n) => n + 1);
  }, []);

  const targetForKey = useCallback((key: string): MatchTarget | null => {
    return targetsRef.current.get(key) ?? null;
  }, []);

  const notifyMatchesSaved = useCallback((jobId: string) => {
    setMatchesSavedTick((prev) => ({
      ...prev,
      [jobId]: (prev[jobId] ?? 0) + 1,
    }));
  }, []);

  return (
    <Context.Provider
      value={{
        activeRouteKey,
        setActiveRouteKey,
        openEntities,
        targetForKey,
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
        matchesSavedTick,
        notifyMatchesSaved,
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

// Hook each FindMatchesButton uses to announce its entity as the
// currently-visible route. Sets activeRouteKey on mount; on
// unmount, only clears the key if it still matches our own (so a
// late mid-route-transition unmount can't blow away a freshly-mounted
// sibling button on the destination page).
export function useFindMatchesActiveRoute(target: MatchTarget) {
  const { setActiveRouteKey } = useFindMatches();
  const key = targetKey(target);
  useEffect(() => {
    setActiveRouteKey(key);
    return () => {
      setActiveRouteKey((prev) => (prev === key ? null : prev));
    };
  }, [key, setActiveRouteKey]);
}
