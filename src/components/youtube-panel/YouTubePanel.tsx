"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  FastForward,
  Loader2,
  Maximize2,
  Minimize2,
  Music,
  Rewind,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  YOUTUBE_PANEL_MIN_H,
  YOUTUBE_PANEL_MIN_W,
  useYouTubePanel,
} from "@/components/youtube-panel/YouTubePanelProvider";
import { useFloatingZ } from "@/lib/floating-z";
import { Button } from "@/components/ui/button";

// Floating YouTube panel with three visual states:
//   search    — query input + results list (no video selected)
//   playing   — iframe full-bleed, slim hover-revealed control bar at bottom
//   minimized — 320x52 dock at bottom-right, iframe stays mounted (covered by
//               the dock UI) so audio keeps playing
//
// The iframe is mounted whenever `activeVideoId` is set and stays absolute-
// positioned to fill the panel root. In minimized mode the panel root itself
// shrinks to 320x52 and the dock UI overlays the iframe at z-10 — the iframe
// keeps playing because it's never unmounted, just visually covered.

type VideoResult = {
  type: "video";
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnail: string;
};

type ChannelResult = {
  type: "channel";
  channelId: string;
  title: string;
  thumbnail: string;
};

type ApiResult = VideoResult | ChannelResult;

type ChannelView = {
  info: ChannelResult;
  videos: VideoResult[];
  loading: boolean;
  nextPageToken: string | null;
  loadingMore: boolean;
};

const DOCK_W = 320;
const DOCK_H = 52;
const DOCK_EDGE_GAP = 24;
const YT_API_SRC = "https://www.youtube.com/iframe_api";
// 15-second skip increment per the recruiter's spec — matches the
// jump-back arrow on Apple's iOS player and most podcast apps.
const SEEK_DELTA = 15;
// Speed cycle order. Click the Speed chip to step to the next rate.
const SPEED_CYCLE = [1, 1.5, 2] as const;

// Subset of the YouTube IFrame Player API surface we actually call.
// Keeps `any` out of the player ref + the speed/seek buttons.
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        target: HTMLElement | string,
        opts: {
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: { onReady?: () => void; onStateChange?: () => void };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export function YouTubePanel() {
  const {
    open,
    position,
    size,
    close,
    setPosition,
    setSize,
  } = useYouTubePanel();
  const { z, bringToFront } = useFloatingZ(open);

  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
  const [channelResults, setChannelResults] = useState<ChannelResult[]>([]);
  const [searching, setSearching] = useState(false);
  // Pagination cursor for the active free-text search. null = no more
  // pages (or no search yet); string = pass to /api/youtube/search to
  // fetch the next 50 items.
  const [searchNextToken, setSearchNextToken] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Last query that produced the current results — used by Load More
  // so a stale token doesn't fetch against an unrelated query.
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeVideoTitle, setActiveVideoTitle] = useState<string>("");
  const [minimized, setMinimized] = useState(false);
  // null = showing search results; set = showing a single channel's
  // latest uploads with a back arrow to return to the search list.
  const [channelView, setChannelView] = useState<ChannelView | null>(null);
  // Playback rate cycles 1 → 1.5 → 2 → 1 via the Speed button. Driven
  // by setPlaybackRate on the YT player, surfaced as the chip label.
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // YouTube IFrame Player API gives us programmatic seekTo +
  // setPlaybackRate. The container div below is what YT.Player
  // attaches to (it replaces the div with its own iframe), so we
  // hold the container ref and the player handle separately.
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  // Re-entry mutex for backToSearch. The state-based check inside
  // backToSearch closes over the captured activeVideoId from the
  // render that built it, so a doubled invocation in the same tick
  // (pointer-capture replay, strict-mode handler replay, focus event
  // bouncing the click) sees the pre-update value and falls through
  // — that's the chain that causes the loop. A ref always reads the
  // live value, so once one back-click latches it true, the next
  // synchronous call bails immediately. Reset by the [activeVideoId]
  // minimize-reset effect below once the transition has actually
  // committed and we're back in the search state.
  const backInFlightRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // YouTube IFrame Player API loader. Once per page lifetime: drop
  // the script tag, return when window.YT is hot. Subsequent video
  // changes reuse the same global API. modestbranding+rel kill the
  // YouTube logo and the related-video grid; controls=1 keeps the
  // native scrubber so the recruiter can still drag the timeline.
  useEffect(() => {
    if (!activeVideoId) return;
    let cancelled = false;

    function bootPlayer() {
      if (cancelled || !window.YT?.Player || !playerContainerRef.current) {
        return;
      }
      try {
        playerRef.current = new window.YT.Player(playerContainerRef.current, {
          videoId: activeVideoId!,
          playerVars: {
            autoplay: 1,
            modestbranding: 1,
            rel: 0,
            controls: 1,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              try {
                // YT.Player can set fixed-pixel width/height on the
                // iframe based on its construction defaults (640x390),
                // which leaves the player visually pinned to that size
                // even when its parent wrapper is sized differently.
                // Force 100%/100% so the iframe always fills the
                // positioning wrapper around it.
                const iframe = playerRef.current?.getIframe();
                if (iframe) {
                  iframe.style.width = "100%";
                  iframe.style.height = "100%";
                  iframe.removeAttribute("width");
                  iframe.removeAttribute("height");
                }
                const r = playerRef.current?.getPlaybackRate() ?? 1;
                setPlaybackRate(r);
              } catch {}
            },
          },
        });
      } catch (e) {
        console.error("[youtube] player init failed", e);
      }
    }

    // Track whether THIS effect run installed the global hook so the
    // cleanup can restore the prior value instead of leaking a stale
    // closure that fires bootPlayer() against an unmounted container
    // when YT.js finally loads after the user has already clicked
    // back-to-search. priorHook is captured outside the closure so the
    // cleanup branch can see it.
    let priorHook: typeof window.onYouTubeIframeAPIReady | undefined;
    let installedHook = false;

    if (window.YT?.Player) {
      bootPlayer();
    } else {
      if (
        !document.querySelector(`script[src="${YT_API_SRC}"]`)
      ) {
        const tag = document.createElement("script");
        tag.src = YT_API_SRC;
        tag.async = true;
        document.body.appendChild(tag);
      }
      // The API calls onYouTubeIframeAPIReady globally when it's
      // hot. Chain through any prior handler so we don't trample
      // another consumer's hook.
      priorHook = window.onYouTubeIframeAPIReady;
      installedHook = true;
      window.onYouTubeIframeAPIReady = () => {
        try {
          priorHook?.();
        } catch {}
        bootPlayer();
      };
    }

    return () => {
      cancelled = true;
      if (installedHook) {
        // Restore whatever was there before we clobbered it. If YT
        // loads after this point, our (now-cancelled) bootPlayer
        // closure doesn't run; the prior consumer's hook (if any)
        // still does. Fixes back-to-search when the YT script load
        // races the click.
        window.onYouTubeIframeAPIReady = priorHook;
      }
      // Null the ref BEFORE destroy() so any re-entry triggered by
      // YT's teardown postMessage can't see a stale player handle.
      const p = playerRef.current;
      playerRef.current = null;
      // YT.Player.destroy() does iframe.parentNode.removeChild(iframe)
      // internally. If React has already unmounted or moved the
      // wrapper by the time this cleanup runs (portal teardown, the
      // `{playing && <div .../>}` conditional collapsing first), the
      // iframe's parent is gone or has different children — destroy()
      // throws "Failed to execute 'removeChild' on 'Node': The node
      // to be removed is not a child of this node" and crashes the
      // whole panel. Skip destroy entirely when the container we
      // handed YT.Player is no longer attached; the orphaned iframe
      // gets reclaimed when its closures drop.
      if (p && playerContainerRef.current?.isConnected) {
        try {
          p.destroy();
        } catch {}
      }
    };
  }, [activeVideoId]);

  function rewind() {
    const p = playerRef.current;
    if (!p) return;
    try {
      const t = p.getCurrentTime();
      p.seekTo(Math.max(0, t - SEEK_DELTA), true);
    } catch {}
  }

  function fastForward() {
    const p = playerRef.current;
    if (!p) return;
    try {
      const t = p.getCurrentTime();
      p.seekTo(t + SEEK_DELTA, true);
    } catch {}
  }

  function cycleSpeed() {
    const p = playerRef.current;
    if (!p) return;
    const idx = SPEED_CYCLE.indexOf(playbackRate as 1 | 1.5 | 2);
    const next = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
    try {
      p.setPlaybackRate(next);
      setPlaybackRate(next);
    } catch {}
  }

  // Focus the search input when the panel opens into the search state.
  // Skipped while a video is playing so we don't yank focus away from the
  // iframe.
  useEffect(() => {
    if (!open) return;
    if (activeVideoId) return;
    inputRef.current?.focus();
  }, [open, activeVideoId]);

  // Reset minimize when the user goes back to the search list — minimize
  // is a "playing state" affordance and shouldn't survive the transition.
  // Also releases the back-to-search re-entry mutex now that the null
  // transition has committed; the next play → back cycle starts fresh.
  useEffect(() => {
    if (!activeVideoId) {
      setMinimized(false);
      backInFlightRef.current = false;
    }
  }, [activeVideoId]);

  // Closing the panel also clears minimize so the next open starts in a
  // predictable visible state.
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

  // On open, if the saved position would put any part of the panel off-
  // screen (window resized smaller while panel was closed, monitor
  // unplugged, etc.), recenter so the recruiter can always see and
  // interact with it.
  useEffect(() => {
    if (!open || !position) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const offScreen =
      position.x < 0 ||
      position.y < 0 ||
      position.x + size.w > w ||
      position.y + size.h > h;
    if (offScreen) {
      setPosition({
        x: Math.max(0, Math.floor((w - size.w) / 2)),
        y: Math.max(0, Math.floor((h - size.h) / 2)),
      });
    }
    // Intentionally only react to `open` flipping — running on every
    // position commit would fight the recruiter's drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-clamp the panel into the viewport whenever the window resizes
  // while the panel is open. Skips the minimized dock — its position is
  // pinned bottom-right via inline style and doesn't need clamping.
  useEffect(() => {
    if (!open || minimized) return;
    function onResize() {
      if (!position) return;
      const maxX = Math.max(0, window.innerWidth - size.w);
      const maxY = Math.max(0, window.innerHeight - size.h);
      const clampedX = Math.max(0, Math.min(maxX, position.x));
      const clampedY = Math.max(0, Math.min(maxY, position.y));
      if (clampedX !== position.x || clampedY !== position.y) {
        setPosition({ x: clampedX, y: clampedY });
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, minimized, position, size, setPosition]);

  // setPointerCapture on the handle element forces every subsequent
  // pointermove / pointerup / pointercancel for this pointerId to fire
  // on the handle, even if the cursor drifts over the YouTube iframe.
  // window listeners alone weren't enough — the iframe absorbed the
  // up event and the panel kept tracking the cursor until the next
  // click. pointercancel is added as belt-and-suspenders for the
  // case where the OS / browser cancels the gesture.
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const node = panelRef.current;
      if (!node || !position) return;
      const handle = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        handle.setPointerCapture(pointerId);
      } catch {}
      const startPx = e.clientX;
      const startPy = e.clientY;
      const startX = position.x;
      const startY = position.y;
      let dx = 0;
      let dy = 0;
      let rafId = 0;
      node.style.willChange = "transform";
      const flush = () => {
        rafId = 0;
        node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      };
      const onMove = (ev: PointerEvent) => {
        const rawX = startX + (ev.clientX - startPx);
        const rawY = startY + (ev.clientY - startPy);
        const maxX = Math.max(0, window.innerWidth - size.w);
        const maxY = Math.max(0, window.innerHeight - size.h);
        const clampedX = Math.max(0, Math.min(maxX, rawX));
        const clampedY = Math.max(0, Math.min(maxY, rawY));
        dx = clampedX - startX;
        dy = clampedY - startY;
        if (rafId === 0) rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {}
        if (rafId !== 0) cancelAnimationFrame(rafId);
        node.style.transform = "";
        node.style.willChange = "";
        const maxX = Math.max(0, window.innerWidth - size.w);
        const maxY = Math.max(0, window.innerHeight - size.h);
        setPosition({
          x: Math.max(0, Math.min(maxX, startX + dx)),
          y: Math.max(0, Math.min(maxY, startY + dy)),
        });
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [position, size, setPosition],
  );

  // Bottom-right corner resize handle. Same pointer-capture pattern as
  // the header drag — without it, dragging across the YouTube iframe
  // swallowed the pointerup and the panel resized forever until the
  // next click.
  const onCornerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const node = panelRef.current;
      if (!node) return;
      const handle = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        handle.setPointerCapture(pointerId);
      } catch {}
      const startPx = e.clientX;
      const startPy = e.clientY;
      const startW = size.w;
      const startH = size.h;
      let nextW = startW;
      let nextH = startH;
      let rafId = 0;
      node.style.willChange = "width, height";
      const flush = () => {
        rafId = 0;
        node.style.width = `${nextW}px`;
        node.style.height = `${nextH}px`;
      };
      const onMove = (ev: PointerEvent) => {
        nextW = Math.max(YOUTUBE_PANEL_MIN_W, startW + (ev.clientX - startPx));
        nextH = Math.max(YOUTUBE_PANEL_MIN_H, startH + (ev.clientY - startPy));
        if (rafId === 0) rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {}
        if (rafId !== 0) cancelAnimationFrame(rafId);
        node.style.willChange = "";
        setSize({ w: nextW, h: nextH });
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [size, setSize],
  );

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setActiveVideoId(null);
    setActiveVideoTitle("");
    setChannelView(null);
    setVideoResults([]);
    setChannelResults([]);
    setSearchNextToken(null);
    try {
      const res = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: ApiResult[];
        nextPageToken?: string | null;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const items = data.results ?? [];
      setVideoResults(
        items.filter((r): r is VideoResult => r.type === "video"),
      );
      setChannelResults(
        items.filter((r): r is ChannelResult => r.type === "channel"),
      );
      setSearchNextToken(data.nextPageToken ?? null);
      setLastSearchedQuery(q);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Search failed";
      toast.error("YouTube search failed", { description: message });
    } finally {
      setSearching(false);
    }
  }

  // Append the next page of search results onto the existing lists.
  // Uses the lastSearchedQuery instead of the live input so the
  // recruiter can keep typing a new query without breaking pagination
  // of the visible results.
  async function loadMoreSearch() {
    if (!searchNextToken || loadingMore || !lastSearchedQuery) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(lastSearchedQuery)}&pageToken=${encodeURIComponent(searchNextToken)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: ApiResult[];
        nextPageToken?: string | null;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const items = data.results ?? [];
      setVideoResults((prev) => [
        ...prev,
        ...items.filter((r): r is VideoResult => r.type === "video"),
      ]);
      setChannelResults((prev) => [
        ...prev,
        ...items.filter((r): r is ChannelResult => r.type === "channel"),
      ]);
      setSearchNextToken(data.nextPageToken ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Load more failed";
      toast.error("Couldn't load more results", { description: message });
    } finally {
      setLoadingMore(false);
    }
  }

  // Click a channel card → fetch that channel's latest uploads via
  // the same route's channelId mode and switch the body to channel
  // view. Optimistic render: set channelView with loading=true so the
  // recruiter sees the channel header immediately while the fetch
  // resolves.
  async function openChannel(c: ChannelResult) {
    setChannelView({
      info: c,
      videos: [],
      loading: true,
      nextPageToken: null,
      loadingMore: false,
    });
    try {
      const res = await fetch(
        `/api/youtube/search?channelId=${encodeURIComponent(c.channelId)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: ApiResult[];
        nextPageToken?: string | null;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const videos = (data.results ?? []).filter(
        (r): r is VideoResult => r.type === "video",
      );
      setChannelView({
        info: c,
        videos,
        loading: false,
        nextPageToken: data.nextPageToken ?? null,
        loadingMore: false,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Channel load failed";
      toast.error("Couldn't load channel", { description: message });
      setChannelView(null);
    }
  }

  // Append the next page of a channel's uploads to the channel view.
  async function loadMoreChannel() {
    if (
      !channelView ||
      !channelView.nextPageToken ||
      channelView.loadingMore ||
      channelView.loading
    ) {
      return;
    }
    const cv = channelView;
    setChannelView({ ...cv, loadingMore: true });
    try {
      const res = await fetch(
        `/api/youtube/search?channelId=${encodeURIComponent(cv.info.channelId)}&pageToken=${encodeURIComponent(cv.nextPageToken!)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: ApiResult[];
        nextPageToken?: string | null;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const more = (data.results ?? []).filter(
        (r): r is VideoResult => r.type === "video",
      );
      setChannelView({
        info: cv.info,
        videos: [...cv.videos, ...more],
        loading: false,
        nextPageToken: data.nextPageToken ?? null,
        loadingMore: false,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Load more failed";
      toast.error("Couldn't load more videos", { description: message });
      setChannelView({ ...cv, loadingMore: false });
    }
  }

  function playVideo(v: VideoResult) {
    setActiveVideoId(v.videoId);
    setActiveVideoTitle(v.title);
  }

  // Back from the playing iframe overlay. Clears the iframe but keeps
  // whichever non-playing state the recruiter came from (search list
  // or channel view) so they land where they were. The ref-based
  // mutex (NOT the activeVideoId compare, which is stale across a
  // synchronous re-entry) is the actual loop break: once the first
  // call latches it, every replay in the same tick exits before
  // dispatching another setState pair.
  function backToSearch() {
    if (backInFlightRef.current) return;
    if (activeVideoId === null) return;
    backInFlightRef.current = true;
    setActiveVideoId(null);
    setActiveVideoTitle("");
  }

  function backFromChannel() {
    setChannelView(null);
  }

  if (!mounted || !open || !position) return null;

  const playing = activeVideoId !== null;

  // Inline style: minimized overrides position+size to a fixed bottom-right
  // dock; otherwise the user-controlled position+size from context drives
  // the floating window.
  const rootStyle: React.CSSProperties = minimized
    ? {
        left: "auto",
        top: "auto",
        right: `${DOCK_EDGE_GAP}px`,
        bottom: `${DOCK_EDGE_GAP}px`,
        width: `${DOCK_W}px`,
        height: `${DOCK_H}px`,
        zIndex: z,
        contain: "layout paint",
      }
    : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        zIndex: z,
        contain: "layout paint",
      };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="YouTube"
      onPointerDownCapture={bringToFront}
      className={
        "group pointer-events-auto fixed flex flex-col overflow-hidden border border-court-border bg-court-surface shadow-2xl " +
        (minimized ? "rounded-lg" : "rounded-xl")
      }
      style={rootStyle}
    >
      {/* YT.Player swaps the inner div for its own iframe at runtime.
          We re-key on activeVideoId so the YT effect tears down +
          rebuilds cleanly on track switch. The div is full-bleed
          (absolute inset-0) so the iframe takes the entire panel —
          our chrome floats on top as a hover-only pill rather than
          stealing layout space, which is what the recruiter asked for
          (full-window video, controls only when needed). */}
      {playing && (
        <div
          key={activeVideoId}
          ref={playerContainerRef}
          title={activeVideoTitle || "YouTube player"}
          className="absolute inset-0 h-full w-full border-0 bg-black"
        />
      )}

      {/* Bottom click-blocker pinned to the lower-left of the iframe,
          sized to cover YouTube's native Share + Watch-Later pills
          (the row below the progress bar). z-[5] sits above the iframe
          but below our hover overlay (z-10) and resize handle (z-20)
          so taps land here and dead-end. We can't strip those buttons
          via player params, so absorbing the click is the closest we
          get to "remove" them. Width keeps the bar narrow enough to
          leave the YouTube logo + "More videos" pill at the right
          untouched. */}
      {playing && !minimized && (
        <div
          aria-hidden
          className="pointer-events-auto absolute bottom-0 left-0 z-[5] h-[64px] w-[200px]"
        />
      )}

      {/* Always-on transparent drag handle spanning the top edge so
          the recruiter can grab the panel from a generous target
          instead of the 280x36 hover pill. Sits above the iframe at
          z-[6] so its pointerdown wins over iframe clicks; below the
          hover pill at z-10 so the pill's buttons take priority where
          they overlap. The right offset leaves a 200px channel clear
          for YouTube's top-right native chrome (volume / CC / settings)
          which the recruiter explicitly asked to keep clickable. */}
      {playing && !minimized && (
        <div
          onPointerDown={onHeaderPointerDown}
          aria-hidden
          className="absolute left-0 top-0 z-[6] h-9 cursor-grab select-none active:cursor-grabbing"
          style={{ right: 200 }}
        />
      )}

      {!playing ? (
        // SEARCH STATE — full-panel layout: header (drag) + search input + results.
        <>
          <div
            onPointerDown={onHeaderPointerDown}
            className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-court-border bg-court-surface-subtle px-4 py-2 active:cursor-grabbing"
          >
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <span className="font-serif text-base font-medium text-court-fg">
                YouTube
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-b border-court-border bg-court-surface px-3 py-2">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Search YouTube…"
              className="flex-1 rounded-md border border-court-border bg-court-surface-subtle px-3 py-1.5 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void runSearch()}
              disabled={searching || !query.trim()}
              aria-label="Search"
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              Search
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {channelView ? (
              <ChannelViewBody
                view={channelView}
                onBack={backFromChannel}
                onPlay={playVideo}
                onLoadMore={() => void loadMoreChannel()}
              />
            ) : searching && videoResults.length === 0 && channelResults.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : videoResults.length === 0 && channelResults.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-court-fg-muted">
                <div className="font-serif text-court-fg">Search YouTube.</div>
                <div className="text-xs">
                  Type a query and press Enter or click Search.
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {channelResults.length > 0 && (
                  <ResultSection title="Channels">
                    <ul className="flex flex-col">
                      {channelResults.map((c) => (
                        <li key={`channel-${c.channelId}`}>
                          <ChannelRow
                            channel={c}
                            onClick={() => void openChannel(c)}
                          />
                        </li>
                      ))}
                    </ul>
                  </ResultSection>
                )}
                {videoResults.length > 0 && (
                  <ResultSection title="Videos">
                    <ul className="flex flex-col">
                      {videoResults.map((v) => (
                        <li key={`video-${v.videoId}`}>
                          <VideoRow video={v} onClick={() => playVideo(v)} />
                        </li>
                      ))}
                    </ul>
                  </ResultSection>
                )}
                {searchNextToken && (
                  <LoadMoreButton
                    loading={loadingMore}
                    onClick={() => void loadMoreSearch()}
                  />
                )}
              </div>
            )}
          </div>
        </>
      ) : minimized ? (
        // MINIMIZED STATE — dock UI overlays the iframe. The iframe
        // beneath keeps playing because it's never unmounted; this dock
        // sits on top at z-10 and visually covers it.
        <div
          onPointerDown={onHeaderPointerDown}
          className="absolute inset-0 z-10 flex cursor-grab select-none items-center gap-2 bg-court-surface px-3 active:cursor-grabbing"
        >
          <Music className="h-4 w-4 shrink-0 text-court-brand" />
          <span
            title={activeVideoTitle}
            className="flex-1 truncate text-xs font-medium text-court-fg"
          >
            {activeVideoTitle || "Now playing"}
          </span>
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label="Restore panel"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        // PLAYING STATE — single hover-only pill anchored top-LEFT.
        // The whole panel reads as full-bleed video; our chrome only
        // appears when the mouse enters the panel. Anchored left so
        // it sits over YouTube's channel-avatar / Subscribe area
        // (which the recruiter doesn't need from inside Ace) instead
        // of the volume / CC / settings cluster YouTube renders at
        // the top-right. `pointer-events-none` keeps the invisible
        // pill from absorbing clicks meant for YouTube's chrome
        // underneath, and `group-hover:pointer-events-auto` re-enables
        // interaction the moment the pill is visible. Backdrop blur +
        // semi-transparent black + ring give it a glass-panel feel
        // closer to a premium media player.
        <div
          onPointerDown={onHeaderPointerDown}
          className="pointer-events-none absolute left-2 top-2 z-10 flex cursor-grab select-none items-center gap-0.5 rounded-md bg-black/55 px-1.5 py-1 text-white opacity-0 ring-1 ring-white/10 backdrop-blur-md transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 active:cursor-grabbing"
        >
          <button
            type="button"
            onClick={backToSearch}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" /> Search
          </button>
          <button
            type="button"
            onClick={rewind}
            className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Rewind 15 seconds"
            title="Rewind 15s"
          >
            <Rewind className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fastForward}
            className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Forward 15 seconds"
            title="Forward 15s"
          >
            <FastForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cycleSpeed}
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label={`Playback speed ${playbackRate}x — click to change`}
            title="Playback speed"
          >
            {playbackRate}x
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Resize is meaningless on the fixed-size mini dock, so the
          handle only mounts in search/playing states. */}
      {!minimized && (
        <div
          onPointerDown={onCornerPointerDown}
          aria-label="Resize from bottom-right"
          className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.4) 50%)",
          }}
        />
      )}
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────
// Result-list helpers

function ResultSection(props: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="bg-court-surface-subtle px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
        {props.title}
      </div>
      {props.children}
    </section>
  );
}

function VideoRow(props: { video: VideoResult; onClick: () => void }) {
  const v = props.video;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full items-start gap-3 px-3 py-2 text-left transition hover:bg-court-surface-subtle"
    >
      {v.thumbnail ? (
        // Plain <img>: thumbnails are external (i.ytimg.com) and
        // pre-sized by YouTube; next/image isn't worth the loader
        // configuration here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.thumbnail}
          alt=""
          className="h-16 w-28 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-16 w-28 shrink-0 rounded bg-court-surface-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-medium text-court-fg">
          {v.title}
        </div>
        <div className="mt-0.5 truncate text-xs text-court-fg-muted">
          {v.channelTitle}
        </div>
      </div>
    </button>
  );
}

function ChannelRow(props: { channel: ChannelResult; onClick: () => void }) {
  const c = props.channel;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-court-surface-subtle"
    >
      {c.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={c.thumbnail}
          alt=""
          className="h-12 w-12 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-full bg-court-surface-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-court-fg">
          {c.title}
        </div>
        <div className="text-xs text-court-fg-muted">Channel</div>
      </div>
    </button>
  );
}

function ChannelViewBody(props: {
  view: ChannelView;
  onBack: () => void;
  onPlay: (v: VideoResult) => void;
  onLoadMore: () => void;
}) {
  const { info, videos, loading, nextPageToken, loadingMore } = props.view;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-court-border bg-court-surface-subtle px-2 py-2">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
          aria-label="Back to search"
        >
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        {info.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={info.thumbnail}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="h-7 w-7 shrink-0 rounded-full bg-court-surface" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-court-fg">
            {info.title}
          </div>
          <div className="text-[11px] text-court-fg-muted">Latest videos</div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-court-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading channel…
        </div>
      ) : videos.length === 0 ? (
        <div className="py-8 text-center text-sm text-court-fg-muted">
          No videos for this channel.
        </div>
      ) : (
        <>
          <ul className="flex flex-col">
            {videos.map((v) => (
              <li key={`channel-vid-${v.videoId}`}>
                <VideoRow video={v} onClick={() => props.onPlay(v)} />
              </li>
            ))}
          </ul>
          {nextPageToken && (
            <LoadMoreButton loading={loadingMore} onClick={props.onLoadMore} />
          )}
        </>
      )}
    </div>
  );
}

function LoadMoreButton(props: { loading: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-center px-3 py-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={props.loading}
        onClick={props.onClick}
      >
        {props.loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </>
        ) : (
          "View more"
        )}
      </Button>
    </div>
  );
}
