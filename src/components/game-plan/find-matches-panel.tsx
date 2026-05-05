"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ExternalLink,
  GripVertical,
  Loader2,
  Minus,
  Send,
  Target,
  X,
} from "lucide-react";
import {
  FIND_MATCHES_MIN_H,
  FIND_MATCHES_MIN_W,
  useFindMatches,
  type CachedFetchState,
  type ClientOpenJob,
  type Match,
  type MatchTarget,
  type ScoreBreakdown,
} from "@/lib/find-matches-context";
import { AddToListButton } from "@/components/lists/add-to-list-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Portal-rendered, draggable, resizable Find Matches panel. Mirrors
// the /mail floating-thread-window pattern: GPU-composited drag via
// transform-friendly absolute positioning, resize handle in the
// bottom-right, state hoisted to FindMatchesProvider so the window
// survives navigation. Does NOT block the page underneath — it sits
// adjacent to the Game Plan chat.

type FetchState =
  | { status: "idle" }
  // Awaiting the recruiter to pick a job from the client's open
  // roles. Server emits this for client targets with 2+ open jobs.
  // Render the picker inside the panel; on pick, kick a new stream
  // with pickedJobId set.
  | {
      status: "awaiting_pick";
      openJobs: ClientOpenJob[];
    }
  // Streaming: Claude is mid-response, matches are appearing one at
  // a time. expected = how many slots to render skeletons for; the
  // gap between matches.length and expected paints loading cards.
  | {
      status: "streaming";
      matches: Match[];
      openJobs: ClientOpenJob[];
      pickedJob: ClientOpenJob | null;
      excludeIds: string[];
      expected: number;
      page: number;
    }
  | {
      status: "ready";
      matches: Match[];
      hasMore: boolean;
      nextPage: number;
      openJobs: ClientOpenJob[];
      pickedJob: ClientOpenJob | null;
      excludeIds: string[];
    }
  // Stream broke mid-way. Carry whatever cards we did receive +
  // surface a retry button.
  | {
      status: "error";
      error: string;
      partialMatches: Match[];
      openJobs: ClientOpenJob[];
      pickedJob: ClientOpenJob | null;
      excludeIds: string[];
      lastPage: number;
    };

const PAGE_SIZE = 5;

export function FindMatchesPanel() {
  const {
    activeRouteKey,
    openEntities,
    targetForKey,
    position,
    size,
    minimized,
    close,
    setPosition,
    setSize,
    setMinimized,
    getCachedFor,
    setCachedFor,
    cacheTick,
  } = useFindMatches();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [state, setState] = useState<FetchState>({ status: "idle" });

  // Resolve the panel's effective target from the route. The render
  // gate below only paints when openEntities contains activeRouteKey,
  // and the cache slot used for fetch/display is keyed off the same
  // key — so navigating between entities flips the panel's contents
  // wholesale instead of lingering on the previous entity.
  const target =
    activeRouteKey && openEntities.has(activeRouteKey)
      ? targetForKey(activeRouteKey)
      : null;

  // Run a streaming fetch. Used both for the initial load and for
  // "Show 5 more" pagination — each call is a fresh stream.
  // excludeIds = candidate IDs already shown OR dismissed, so neither
  // pagination nor dismissed candidates ever come back.
  const runStream = useCallback(
    async (args: {
      target: MatchTarget;
      pickedJobId?: string;
      page: number;
      excludeIds: string[];
      previousMatches: Match[];
      previousOpenJobs: ClientOpenJob[];
      previousPickedJob: ClientOpenJob | null;
      cacheKey: string;
    }) => {
      const {
        target,
        pickedJobId,
        page,
        excludeIds,
        previousMatches,
        previousOpenJobs,
        previousPickedJob,
        cacheKey,
      } = args;
      // Optimistic streaming state — render PAGE_SIZE skeletons under
      // the previously-loaded cards while Claude scores the next batch.
      let liveMatches: Match[] = [...previousMatches];
      let liveOpenJobs: ClientOpenJob[] = previousOpenJobs;
      let livePickedJob: ClientOpenJob | null = previousPickedJob;
      const seenIds = new Set(excludeIds);
      let liveExcludeIds: string[] = [...excludeIds];
      let awaitingPickSeen = false;
      setState({
        status: "streaming",
        matches: liveMatches,
        openJobs: liveOpenJobs,
        pickedJob: livePickedJob,
        excludeIds: liveExcludeIds,
        expected: liveMatches.length + PAGE_SIZE,
        page,
      });
      const result = await streamMatches(
        target,
        page,
        excludeIds,
        pickedJobId ?? null,
        {
          onMeta: ({ openJobs, pickedJobLabel }) => {
            if (openJobs.length > 0) liveOpenJobs = openJobs;
            // pickedJobLabel comes back when the server narrowed the
            // target to a specific job (either auto-picked single-job
            // client OR an explicit pickedJobId). Reflect it in
            // pickedJob so the header subtitle updates.
            if (pickedJobLabel && pickedJobId) {
              livePickedJob =
                liveOpenJobs.find((j) => j.jobId === pickedJobId) ?? livePickedJob;
            } else if (pickedJobLabel && liveOpenJobs.length === 1) {
              livePickedJob = liveOpenJobs[0];
            }
          },
          onAwaitingPick: () => {
            awaitingPickSeen = true;
            setState({ status: "awaiting_pick", openJobs: liveOpenJobs });
          },
          onMatch: (m) => {
            if (seenIds.has(m.candidateId)) return;
            seenIds.add(m.candidateId);
            liveMatches = [...liveMatches, m];
            liveExcludeIds = [...liveExcludeIds, m.candidateId];
            setState({
              status: "streaming",
              matches: liveMatches,
              openJobs: liveOpenJobs,
              pickedJob: livePickedJob,
              excludeIds: liveExcludeIds,
              expected: previousMatches.length + PAGE_SIZE,
              page,
            });
          },
          onEnd: ({ hasMore }) => {
            if (awaitingPickSeen) return; // already in awaiting_pick state
            const cached: CachedFetchState = {
              matches: liveMatches,
              hasMore,
              nextPage: page + 1,
              openJobs: liveOpenJobs,
              pickedJob: livePickedJob,
              excludeIds: liveExcludeIds,
            };
            setCachedFor(cacheKey, cached);
            setState({ status: "ready", ...cached });
          },
        },
      );
      if (!result.ok) {
        setState({
          status: "error",
          error: result.error,
          partialMatches: liveMatches,
          openJobs: liveOpenJobs,
          pickedJob: livePickedJob,
          excludeIds: liveExcludeIds,
          lastPage: page,
        });
      }
    },
    [setCachedFor],
  );

  useEffect(() => {
    if (!target || !activeRouteKey) {
      setState({ status: "idle" });
      return;
    }
    const cached = getCachedFor(activeRouteKey);
    if (cached) {
      setState({ status: "ready", ...cached });
      return;
    }
    void runStream({
      target,
      page: 0,
      excludeIds: [],
      previousMatches: [],
      previousOpenJobs: [],
      previousPickedJob: null,
      cacheKey: activeRouteKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteKey, openEntities, cacheTick]);

  async function loadMore() {
    if (!target || !activeRouteKey || state.status !== "ready") return;
    await runStream({
      target,
      pickedJobId: state.pickedJob?.jobId,
      page: state.nextPage,
      excludeIds: state.excludeIds,
      previousMatches: state.matches,
      previousOpenJobs: state.openJobs,
      previousPickedJob: state.pickedJob,
      cacheKey: activeRouteKey,
    });
  }

  async function retryFromError() {
    if (!target || !activeRouteKey || state.status !== "error") return;
    await runStream({
      target,
      pickedJobId: state.pickedJob?.jobId,
      page: state.lastPage,
      excludeIds: state.excludeIds,
      previousMatches: state.partialMatches,
      previousOpenJobs: state.openJobs,
      previousPickedJob: state.pickedJob,
      cacheKey: activeRouteKey,
    });
  }

  // ITEM 1: pick a job from the awaiting_pick state and re-run the
  // stream with that pickedJobId. Cache + history reset for this
  // entity since the picked job changes the search target.
  async function pickJob(job: ClientOpenJob) {
    if (!target || !activeRouteKey) return;
    await runStream({
      target,
      pickedJobId: job.jobId,
      page: 0,
      excludeIds: [],
      previousMatches: [],
      previousOpenJobs: state.status === "awaiting_pick" ? state.openJobs : [],
      previousPickedJob: job,
      cacheKey: activeRouteKey,
    });
  }

  // ITEM 2: dismiss a card. Removes it from the visible list, adds
  // it to excludeIds so it never comes back on Show 5 more, and
  // updates the cache slot for this entity.
  function dismissMatch(candidateId: string) {
    if (!activeRouteKey) return;
    setState((cur) => {
      if (cur.status === "ready") {
        const matches = cur.matches.filter((m) => m.candidateId !== candidateId);
        const excludeIds = cur.excludeIds.includes(candidateId)
          ? cur.excludeIds
          : [...cur.excludeIds, candidateId];
        const next: CachedFetchState = {
          matches,
          hasMore: cur.hasMore,
          nextPage: cur.nextPage,
          openJobs: cur.openJobs,
          pickedJob: cur.pickedJob,
          excludeIds,
        };
        setCachedFor(activeRouteKey, next);
        return { status: "ready", ...next };
      }
      if (cur.status === "streaming") {
        const matches = cur.matches.filter((m) => m.candidateId !== candidateId);
        const excludeIds = cur.excludeIds.includes(candidateId)
          ? cur.excludeIds
          : [...cur.excludeIds, candidateId];
        return { ...cur, matches, excludeIds };
      }
      if (cur.status === "error") {
        const partialMatches = cur.partialMatches.filter(
          (m) => m.candidateId !== candidateId,
        );
        const excludeIds = cur.excludeIds.includes(candidateId)
          ? cur.excludeIds
          : [...cur.excludeIds, candidateId];
        return { ...cur, partialMatches, excludeIds };
      }
      return cur;
    });
  }

  // Drag the title bar — shifts the absolute (left, top) coordinates
  // tracked in context so the wrapper persists across re-renders.
  const dragStateRef = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function onTitleBarMouseDown(e: React.MouseEvent) {
    if (!position) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    dragStateRef.current = {
      dx: position.x,
      dy: position.y,
      startX: e.clientX,
      startY: e.clientY,
    };
    setIsDragging(true);
  }

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      const s = dragStateRef.current;
      if (!s) return;
      const nx = s.dx + (e.clientX - s.startX);
      const ny = s.dy + (e.clientY - s.startY);
      setPosition({ x: Math.max(0, nx), y: Math.max(0, ny) });
    }
    function onUp() {
      setIsDragging(false);
      dragStateRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, setPosition]);

  // Resize handle (bottom-right corner). Same pattern as the mail
  // composer modal — track delta from the original size as the
  // recruiter drags.
  const resizeStateRef = useRef<{
    w: number;
    h: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  function onResizeMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    resizeStateRef.current = {
      w: size.w,
      h: size.h,
      startX: e.clientX,
      startY: e.clientY,
    };
    setIsResizing(true);
  }

  useEffect(() => {
    if (!isResizing) return;
    function onMove(e: MouseEvent) {
      const s = resizeStateRef.current;
      if (!s) return;
      const nw = s.w + (e.clientX - s.startX);
      const nh = s.h + (e.clientY - s.startY);
      setSize({
        w: Math.max(FIND_MATCHES_MIN_W, nw),
        h: Math.max(FIND_MATCHES_MIN_H, nh),
      });
    }
    function onUp() {
      setIsResizing(false);
      resizeStateRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizing, setSize]);

  if (!mounted || typeof document === "undefined") return null;
  if (!target || !position) return null;
  if (minimized) return null;

  const node = (
    <div
      role="dialog"
      aria-label="Find matches"
      className="pointer-events-none fixed inset-0 z-[1050]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ left: position.x, top: position.y, width: size.w, height: size.h }}
        className="pointer-events-auto absolute"
      >
        {/* Panel chrome (Prompt 3 Item 3): a 2px Court-token border for
            clear separation from the page underneath, body in
            bg-court-surface, header bar in bg-court-surface-subtle so
            the title strip reads as a slightly recessed band against
            the body. All tokens — works across all six Court modes. */}
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border-2 border-court-border bg-court-surface shadow-2xl">
          <div
            onMouseDown={onTitleBarMouseDown}
            className={cn(
              "flex shrink-0 select-none items-center justify-between border-b border-court-border bg-court-surface-subtle px-4 py-2",
              isDragging ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <GripVertical className="h-3.5 w-3.5 text-court-fg-muted" />
              <Target className="h-3.5 w-3.5 text-court-accent" />
              <div className="flex min-w-0 flex-col">
                <div className="text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
                  Find Matches
                </div>
                <div className="truncate text-[11px] text-court-fg-muted">
                  {(() => {
                    // For client targets, prefer the picked-job title
                    // once one's been selected — that's the actual
                    // search target the recruiter is looking at.
                    if (state.status === "ready" || state.status === "streaming" || state.status === "error") {
                      const picked = state.pickedJob;
                      if (picked) return picked.title;
                    }
                    return target.label;
                  })()}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1" data-no-drag>
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                aria-label="Minimize"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto bg-court-surface p-3">
            {state.status === "awaiting_pick" && (
              <JobPickPrompt openJobs={state.openJobs} onPick={pickJob} />
            )}
            {state.status === "streaming" && (
              <ul className="space-y-2">
                {state.matches.map((m) => (
                  <li key={m.candidateId}>
                    <MatchCard
                      match={m}
                      target={target}
                      openJobs={state.openJobs}
                      pickedJob={state.pickedJob}
                      onDismiss={dismissMatch}
                    />
                  </li>
                ))}
                {Array.from({
                  length: Math.max(0, state.expected - state.matches.length),
                }).map((_, i) => (
                  <li key={`skel-${i}`}>
                    <SkeletonCard />
                  </li>
                ))}
              </ul>
            )}
            {state.status === "error" && (
              <>
                {state.partialMatches.length > 0 && (
                  <ul className="mb-3 space-y-2">
                    {state.partialMatches.map((m) => (
                      <li key={m.candidateId}>
                        <MatchCard
                          match={m}
                          target={target}
                          openJobs={state.openJobs}
                          pickedJob={state.pickedJob}
                          onDismiss={dismissMatch}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <div className="font-semibold">
                    {state.partialMatches.length > 0
                      ? "Stream broke after a few matches."
                      : "Find Matches failed."}
                  </div>
                  <div className="mt-0.5 text-red-700">{state.error}</div>
                  <button
                    type="button"
                    onClick={retryFromError}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] font-semibold text-red-800 transition hover:bg-red-100"
                  >
                    Retry
                  </button>
                </div>
              </>
            )}
            {state.status === "ready" && state.matches.length === 0 && (
              <div className="rounded-lg border border-court-border bg-court-surface p-5 text-center text-sm text-court-fg-muted">
                No strong matches in your database. Try sourcing externally.
              </div>
            )}
            {state.status === "ready" && state.matches.length > 0 && (
              <ul className="space-y-2">
                {state.matches.map((m) => (
                  <li key={m.candidateId}>
                    <MatchCard
                      match={m}
                      target={target}
                      openJobs={state.openJobs}
                      pickedJob={state.pickedJob}
                      onDismiss={dismissMatch}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state.status === "ready" && state.hasMore && (
            <div className="shrink-0 border-t border-court-border bg-court-surface px-3 py-2">
              <button
                type="button"
                onClick={loadMore}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-xs font-semibold text-court-fg transition hover:bg-court-surface-subtle"
              >
                Show 5 more
              </button>
            </div>
          )}

          <div
            onMouseDown={onResizeMouseDown}
            aria-label="Resize"
            className={cn(
              "absolute bottom-1 right-1 h-4 w-4 rounded-sm",
              isResizing ? "cursor-nwse-resize bg-court-fg/10" : "cursor-nwse-resize hover:bg-court-fg/5",
            )}
            style={{
              backgroundImage:
                "linear-gradient(135deg, transparent 0 35%, currentColor 35% 45%, transparent 45% 65%, currentColor 65% 75%, transparent 75%)",
              color: "rgba(0,0,0,0.25)",
            }}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-court-border bg-court-surface p-4">
      <div className="h-3 w-1/3 rounded bg-court-surface-subtle" />
      <div className="mt-2 h-3 w-2/3 rounded bg-court-surface-subtle" />
      <div className="mt-3 h-2 w-full rounded bg-court-surface-subtle" />
      <div className="mt-1 h-2 w-5/6 rounded bg-court-surface-subtle" />
    </div>
  );
}

function MatchCard({
  match,
  target,
  openJobs,
  pickedJob,
  onDismiss,
}: {
  match: Match;
  target: MatchTarget;
  openJobs: ClientOpenJob[];
  pickedJob: ClientOpenJob | null;
  onDismiss: (candidateId: string) => void;
}) {
  const [applyError, setApplyError] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-court-border bg-court-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold text-court-fg">{match.name}</span>
            <ScoreBadge score={match.score} breakdown={match.scoreBreakdown} />
          </div>
          {(match.title || match.currentEmployer) && (
            <div className="mt-0.5 truncate text-xs text-court-fg-muted">
              {match.title}
              {match.title && match.currentEmployer ? " · " : ""}
              {match.currentEmployer}
            </div>
          )}
          {(match.location || match.comp) && (
            <div className="mt-0.5 text-[11px] text-court-fg-muted">
              {match.location}
              {match.location && match.comp ? " · " : ""}
              {match.comp}
            </div>
          )}
        </div>
        {/* ITEM 2: dismiss X — removes the card client-side and adds
            its candidateId to excludeIds so it never resurfaces on
            "Show 5 more". No API call. */}
        <button
          type="button"
          onClick={() => onDismiss(match.candidateId)}
          aria-label={`Dismiss ${match.name}`}
          className="shrink-0 rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {match.rationale && (
        <p className="mt-2 text-xs leading-relaxed text-court-fg">{match.rationale}</p>
      )}
      {applyError && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {applyError}
        </div>
      )}
      <ActionRow
        match={match}
        target={target}
        openJobs={openJobs}
        pickedJob={pickedJob}
        onDismiss={onDismiss}
        onApplyError={(msg) => setApplyError(msg)}
        clearApplyError={() => setApplyError(null)}
      />
    </div>
  );
}

// Score color buckets (Prompt 3 Item 1):
//   85-100 → green
//   70-84  → orange
//    < 70  → grey
// Hardcoded color names per the spec — these are intentional brand
// signals (green = strong, orange = decent, grey = weak) that should
// read identically across all six Court modes.
function scoreTone(score: number): string {
  if (score >= 85) return "bg-green-600 text-white";
  if (score >= 70) return "bg-orange-500 text-white";
  return "bg-gray-400 text-white";
}

function ScoreBadge({
  score,
  breakdown,
}: {
  score: number;
  breakdown: ScoreBreakdown;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Score ${score} - click for breakdown`}
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-court-accent/40",
          scoreTone(score),
        )}
      >
        {score}
      </button>
      {open && <ScorePopover score={score} breakdown={breakdown} />}
    </div>
  );
}

function ScorePopover({
  score,
  breakdown,
}: {
  score: number;
  breakdown: ScoreBreakdown;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Title match", value: breakdown.titleMatch },
    { label: "Location fit", value: breakdown.locationFit },
    { label: "Experience fit", value: breakdown.experienceFit },
    { label: "Compensation fit", value: breakdown.compensationFit },
  ].filter((r) => r.value);
  return (
    <div
      role="dialog"
      className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-court-border bg-court-surface p-3 shadow-xl"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("rounded-full px-2.5 py-1 text-sm font-bold", scoreTone(score))}>
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-court-fg-muted">
          Why this score
        </span>
      </div>
      {breakdown.overallSummary && (
        <p className="mt-2 text-xs leading-relaxed text-court-fg">
          {breakdown.overallSummary}
        </p>
      )}
      {rows.length > 0 && (
        <dl className="mt-3 space-y-2 border-t border-court-border pt-2">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
                {r.label}
              </dt>
              <dd className="mt-0.5 text-[11px] leading-relaxed text-court-fg">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ActionRow({
  match,
  target,
  openJobs,
  pickedJob,
  onDismiss,
  onApplyError,
  clearApplyError,
}: {
  match: Match;
  target: MatchTarget;
  openJobs: ClientOpenJob[];
  pickedJob: ClientOpenJob | null;
  onDismiss: (candidateId: string) => void;
  onApplyError: (msg: string) => void;
  clearApplyError: () => void;
}) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);

  // Resolve the jobId/jobRfId we should target for this card. JOB
  // context: the page's job. CLIENT context: the picked job (Item 1
  // gates the panel from streaming until a pick exists; this is
  // belt-and-suspenders for code paths that might run before pick).
  const targetJobId =
    target.kind === "job"
      ? target.jobId
      : pickedJob?.jobId ?? (openJobs.length === 1 ? openJobs[0].jobId : null);
  const targetJobRfId =
    target.kind === "job"
      ? target.jobRfId
      : pickedJob?.jobRfId ?? (openJobs.length === 1 ? openJobs[0].jobRfId : null);

  // ITEM 3: one-click Apply. POSTs directly to /api/placements with
  // stage APPLIED — no modal, no navigation. Existing Apply to Job
  // modal elsewhere in the app is intentionally NOT touched.
  async function onApply() {
    if (!targetJobId) {
      onApplyError("No target job — pick a job first.");
      return;
    }
    clearApplyError();
    setApplying(true);
    try {
      const res = await fetch("/api/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: match.candidateId,
          jobId: targetJobId,
          stage: "APPLIED",
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) {
        const msg = body?.error ?? `Apply failed (${res.status})`;
        onApplyError(msg);
        setApplying(false);
        return;
      }
      // Success: dismiss the card so the panel removes it
      // immediately. The placement is already in Neon; no further
      // navigation needed.
      onDismiss(match.candidateId);
    } catch (e) {
      onApplyError(e instanceof Error ? e.message : "Network error");
      setApplying(false);
    }
  }

  // Submit (untouched per spec — Prompt 3 work) still routes to the
  // candidate profile's existing Submit modal via the deep-link
  // params it already understands.
  function onSubmit() {
    const candidatePath = `/candidates/${match.candidateRfId ?? match.candidateId}`;
    if (targetJobRfId != null) {
      router.push(`${candidatePath}?submit=${targetJobRfId}`);
    } else {
      router.push(`${candidatePath}?openSubmit=1`);
    }
    // Auto-dismiss after firing — match cards should leave once the
    // recruiter has acted on them.
    onDismiss(match.candidateId);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <a
        href={`/candidates/${match.candidateRfId ?? match.candidateId}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => onDismiss(match.candidateId)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
      >
        <ExternalLink className="h-3 w-3" /> View Profile
      </a>
      <span onClick={() => onDismiss(match.candidateId)}>
        <AddToListButton candidateId={match.candidateId} candidateName={match.name} />
      </span>
      <Button
        type="button"
        size="sm"
        variant="apply"
        onClick={onApply}
        disabled={applying}
      >
        {applying ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Target className="h-3 w-3" />
        )}
        Apply
      </Button>
      <Button type="button" size="sm" onClick={onSubmit}>
        <Send className="h-3 w-3" /> Submit
      </Button>
    </div>
  );
}

// In-panel job picker shown when the panel was opened from a client
// page that has 2+ open jobs. Search doesn't run until a job is
// picked — keeping Claude focused on a single role's requirements
// instead of an undifferentiated union.
function JobPickPrompt({
  openJobs,
  onPick,
}: {
  openJobs: ClientOpenJob[];
  onPick: (job: ClientOpenJob) => void;
}) {
  if (openJobs.length === 0) {
    return (
      <div className="rounded-lg border border-court-border bg-court-surface p-5 text-center text-sm text-court-fg-muted">
        No open jobs at this client. Open a role first, then run Find Matches.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-court-border bg-court-surface p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
        Which job?
      </div>
      <p className="mb-3 text-[11px] text-court-fg-muted">
        Pick a role to score candidates against. The search runs against this
        single job, not the union of all open roles.
      </p>
      <ul className="space-y-1">
        {openJobs.map((j) => (
          <li key={j.jobId}>
            <button
              type="button"
              onClick={() => onPick(j)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-court-border bg-court-surface-subtle/30 px-3 py-2 text-left text-sm text-court-fg transition hover:border-court-accent hover:bg-court-accent-tint/40"
            >
              <span className="truncate font-medium">{j.title}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Streaming NDJSON reader. The route emits one JSON object per
// newline; we forward each parsed event to the panel via callbacks
// so cards paint progressively as Claude scores them.
async function streamMatches(
  target: MatchTarget,
  page: number,
  excludeIds: string[],
  pickedJobId: string | null,
  callbacks: {
    onMeta: (info: {
      openJobs: ClientOpenJob[];
      pickedJobLabel: string | null;
    }) => void;
    onAwaitingPick: () => void;
    onMatch: (match: Match) => void;
    onEnd: (info: { hasMore: boolean; page: number }) => void;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    const body =
      target.kind === "job"
        ? { jobId: target.jobId, page, excludeIds }
        : {
            clientId: target.clientId,
            page,
            excludeIds,
            // ITEM 1: pickedJobId narrows the client target to a
            // specific role server-side. Server emits awaiting_pick
            // when this is missing AND the client has 2+ open jobs.
            pickedJobId: pickedJobId ?? undefined,
          };
    res = await fetch("/api/game-plan/find-matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
  if (!res.ok || !res.body) {
    let err = `Find matches failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j?.error === "string") err = j.error;
    } catch {
      // body wasn't JSON; keep the status-based error
    }
    return { ok: false, error: err };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let endSeen = false;
  let streamError: string | null = null;
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    let event: {
      t?: unknown;
      match?: unknown;
      openJobs?: unknown;
      pickedJobLabel?: unknown;
      hasMore?: unknown;
      page?: unknown;
      error?: unknown;
    };
    try {
      event = JSON.parse(line);
    } catch {
      return; // skip malformed line silently
    }
    if (event.t === "meta") {
      callbacks.onMeta({
        openJobs: Array.isArray(event.openJobs) ? (event.openJobs as ClientOpenJob[]) : [],
        pickedJobLabel:
          typeof event.pickedJobLabel === "string" ? event.pickedJobLabel : null,
      });
    } else if (event.t === "awaiting_pick") {
      callbacks.onAwaitingPick();
    } else if (event.t === "match" && event.match && typeof event.match === "object") {
      callbacks.onMatch(event.match as Match);
    } else if (event.t === "end") {
      endSeen = true;
      callbacks.onEnd({
        hasMore: Boolean(event.hasMore),
        page: typeof event.page === "number" ? event.page : page,
      });
    } else if (event.t === "error") {
      streamError = typeof event.error === "string" ? event.error : "Stream error";
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    }
    // Flush any tail without a trailing newline.
    if (buffer.trim()) handleLine(buffer);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stream interrupted" };
  }
  if (streamError) return { ok: false, error: streamError };
  if (!endSeen) {
    return { ok: false, error: "Stream ended unexpectedly" };
  }
  return { ok: true };
}
