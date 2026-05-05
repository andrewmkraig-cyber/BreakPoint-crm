"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
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
  type ClientOpenJob,
  type MatchTarget,
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

type Match = {
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

type FetchState =
  | { status: "idle" }
  | { status: "loading"; page: number }
  | {
      status: "ready";
      matches: Match[];
      hasMore: boolean;
      nextPage: number;
      openJobs: ClientOpenJob[];
    }
  | { status: "error"; error: string };

export function FindMatchesPanel() {
  const {
    target,
    position,
    size,
    minimized,
    close,
    setPosition,
    setSize,
    setMinimized,
  } = useFindMatches();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [paging, setPaging] = useState(false);

  // Reset + initial fetch whenever the target changes.
  useEffect(() => {
    if (!target) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    (async () => {
      setState({ status: "loading", page: 0 });
      const result = await fetchMatches(target, 0);
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error", error: result.error });
        return;
      }
      setState({
        status: "ready",
        matches: result.matches,
        hasMore: result.hasMore,
        nextPage: result.page + 1,
        openJobs: result.openJobs,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  async function loadMore() {
    if (!target || state.status !== "ready") return;
    setPaging(true);
    const result = await fetchMatches(target, state.nextPage);
    setPaging(false);
    if (!result.ok) return;
    setState({
      status: "ready",
      matches: [...state.matches, ...result.matches],
      hasMore: result.hasMore,
      nextPage: result.page + 1,
      openJobs: state.openJobs,
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
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl">
          <div
            onMouseDown={onTitleBarMouseDown}
            className={cn(
              "flex shrink-0 select-none items-center justify-between border-b border-court-border px-4 py-2",
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
                <div className="truncate text-[11px] text-court-fg-muted">{target.label}</div>
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

          <div className="flex-1 min-h-0 overflow-y-auto bg-court-surface-subtle/30 p-3">
            {state.status === "loading" && <SkeletonList />}
            {state.status === "error" && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {state.error}
              </div>
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
                disabled={paging}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-court-border bg-court-surface-subtle/40 px-3 py-1.5 text-xs font-semibold text-court-fg transition hover:bg-court-surface-subtle disabled:opacity-60"
              >
                {paging ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
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

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="rounded-lg border border-court-border bg-court-surface p-4"
        >
          <div className="h-3 w-1/3 rounded bg-court-surface-subtle" />
          <div className="mt-2 h-3 w-2/3 rounded bg-court-surface-subtle" />
          <div className="mt-3 h-2 w-full rounded bg-court-surface-subtle" />
          <div className="mt-1 h-2 w-5/6 rounded bg-court-surface-subtle" />
        </li>
      ))}
    </ul>
  );
}

function MatchCard({
  match,
  target,
  openJobs,
}: {
  match: Match;
  target: MatchTarget;
  openJobs: ClientOpenJob[];
}) {
  return (
    <div className="rounded-lg border border-court-border bg-court-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold text-court-fg">{match.name}</span>
            <ScoreBadge score={match.score} />
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
      </div>
      {match.rationale && (
        <p className="mt-2 text-xs leading-relaxed text-court-fg">{match.rationale}</p>
      )}
      <ActionRow match={match} target={target} openJobs={openJobs} />
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 85
      ? "bg-court-accent-tint text-court-accent-dark"
      : score >= 70
        ? "bg-amber-100 text-amber-800"
        : "bg-court-surface-subtle text-court-fg-muted";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tone,
      )}
    >
      {score}
    </span>
  );
}

function ActionRow({
  match,
  target,
  openJobs,
}: {
  match: Match;
  target: MatchTarget;
  openJobs: ClientOpenJob[];
}) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState<"apply" | "submit" | null>(null);

  // For job context: jobRfId is fixed (the page we're on). For client
  // context: the recruiter picks a job from the panel's inline
  // dropdown before we route.
  function navigate(action: "apply" | "submit", jobRfId: number | null) {
    const candidatePath = `/candidates/${match.candidateRfId ?? match.candidateId}`;
    if (action === "submit" && jobRfId != null) {
      router.push(`${candidatePath}?submit=${jobRfId}`);
      return;
    }
    if (action === "submit") {
      router.push(`${candidatePath}?openSubmit=1`);
      return;
    }
    router.push(`${candidatePath}?openApply=1`);
  }

  function onClickApplyOrSubmit(action: "apply" | "submit") {
    if (target.kind === "job") {
      navigate(action, target.jobRfId);
      return;
    }
    // Client context: open the inline picker. If the client only has
    // one open job, route immediately — picker is just noise.
    if (openJobs.length === 1) {
      navigate(action, openJobs[0].jobRfId);
      return;
    }
    if (openJobs.length === 0) {
      // No open jobs at this client — fall through to the candidate's
      // generic Apply/Submit modal where the recruiter can pick any
      // job in the org.
      navigate(action, null);
      return;
    }
    setPickerOpen(action);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <a
        href={`/candidates/${match.candidateRfId ?? match.candidateId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
      >
        <ExternalLink className="h-3 w-3" /> View Profile
      </a>
      <AddToListButton candidateId={match.candidateId} candidateName={match.name} />
      <Button
        type="button"
        size="sm"
        variant="apply"
        onClick={() => onClickApplyOrSubmit("apply")}
      >
        <Target className="h-3 w-3" /> Apply
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => onClickApplyOrSubmit("submit")}
      >
        <Send className="h-3 w-3" /> Submit
      </Button>
      {pickerOpen && target.kind === "client" && (
        <ClientJobPicker
          openJobs={openJobs}
          onPick={(j) => {
            const action = pickerOpen;
            setPickerOpen(null);
            navigate(action, j.jobRfId);
          }}
          onClose={() => setPickerOpen(null)}
          action={pickerOpen}
        />
      )}
    </div>
  );
}

function ClientJobPicker({
  openJobs,
  onPick,
  onClose,
  action,
}: {
  openJobs: ClientOpenJob[];
  onPick: (j: ClientOpenJob) => void;
  onClose: () => void;
  action: "apply" | "submit";
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div ref={wrapRef} className="basis-full">
      <div className="mt-2 rounded-md border border-court-border bg-court-surface-subtle/40 p-2">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
          <ChevronDown className="h-3 w-3" /> Pick a job to {action}
        </div>
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {openJobs.map((j) => (
            <li key={j.jobId}>
              <button
                type="button"
                onClick={() => onPick(j)}
                className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-court-fg transition hover:bg-court-accent-tint/40"
              >
                {j.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

async function fetchMatches(
  target: MatchTarget,
  page: number,
): Promise<
  | {
      ok: true;
      matches: Match[];
      hasMore: boolean;
      page: number;
      openJobs: ClientOpenJob[];
    }
  | { ok: false; error: string }
> {
  try {
    const body =
      target.kind === "job"
        ? { jobId: target.jobId, page }
        : { clientId: target.clientId, page };
    const res = await fetch("/api/game-plan/find-matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: json?.error ?? `Find matches failed (${res.status})` };
    }
    return {
      ok: true,
      matches: (json?.matches ?? []) as Match[],
      hasMore: Boolean(json?.hasMore),
      page: typeof json?.page === "number" ? json.page : page,
      openJobs: (json?.openJobs ?? []) as ClientOpenJob[],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
