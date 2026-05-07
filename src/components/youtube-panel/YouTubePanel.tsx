"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, X, ArrowLeft, Minimize2, Maximize2, Music } from "lucide-react";
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

type SearchResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
};

const DOCK_W = 320;
const DOCK_H = 52;
const DOCK_EDGE_GAP = 24;

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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeVideoTitle, setActiveVideoTitle] = useState<string>("");
  const [minimized, setMinimized] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
  useEffect(() => {
    if (!activeVideoId) setMinimized(false);
  }, [activeVideoId]);

  // Closing the panel also clears minimize so the next open starts in a
  // predictable visible state.
  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const node = panelRef.current;
      if (!node || !position) return;
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
        dx = ev.clientX - startPx;
        dy = ev.clientY - startPy;
        if (rafId === 0) rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
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
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [position, size, setPosition],
  );

  // Bottom-right corner resize handle. Mutates width/height directly during
  // drag for GPU-friendly perf, then commits to context state on pointerup.
  const onCornerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const node = panelRef.current;
      if (!node) return;
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
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (rafId !== 0) cancelAnimationFrame(rafId);
        node.style.willChange = "";
        setSize({ w: nextW, h: nextH });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [size, setSize],
  );

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setActiveVideoId(null);
    setActiveVideoTitle("");
    try {
      const res = await fetch(
        `/api/youtube/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: SearchResult[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setResults(data.results ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Search failed";
      toast.error("YouTube search failed", { description: message });
    } finally {
      setSearching(false);
    }
  }

  function playResult(r: SearchResult) {
    setActiveVideoId(r.videoId);
    setActiveVideoTitle(r.title);
  }

  function backToSearch() {
    setActiveVideoId(null);
    setActiveVideoTitle("");
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
      {/* Iframe stays mounted whenever activeVideoId is set so audio
          continues to play across state changes (search ↔ playing ↔
          minimized). It absolute-fills the panel root; in minimized
          mode that's 320x52 and the dock UI on top covers it visually. */}
      {playing && (
        <iframe
          key={activeVideoId}
          src={`https://www.youtube.com/embed/${activeVideoId}?autoplay=1`}
          title={activeVideoTitle || "YouTube player"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0 bg-black"
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
            {searching && results.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-court-fg-muted">
                <div className="font-serif text-court-fg">Search YouTube.</div>
                <div className="text-xs">
                  Type a query and press Enter or click Search.
                </div>
              </div>
            ) : (
              <ul className="flex flex-col">
                {results.map((r) => (
                  <li key={r.videoId}>
                    <button
                      type="button"
                      onClick={() => playResult(r)}
                      className="flex w-full items-start gap-3 px-3 py-2 text-left transition hover:bg-court-surface-subtle"
                    >
                      {r.thumbnail ? (
                        // Plain <img>: thumbnails are external (i.ytimg.com)
                        // and pre-sized by YouTube; next/image isn't worth
                        // the loader configuration here.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail}
                          alt=""
                          className="h-16 w-28 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-16 w-28 shrink-0 rounded bg-court-surface-subtle" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm font-medium text-court-fg">
                          {r.title}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-court-fg-muted">
                          {r.channelTitle}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
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
        // PLAYING STATE — iframe (above) is full bleed. Hover overlay
        // bar appears at the bottom on hover only. Buttons stop drag
        // propagation so clicking them never starts a window drag.
        <div
          onPointerDown={onHeaderPointerDown}
          className="absolute inset-x-0 bottom-0 z-10 flex h-9 cursor-grab select-none items-center gap-1 bg-black/70 px-3 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 active:cursor-grabbing"
        >
          <button
            type="button"
            onClick={backToSearch}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" /> Search
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="rounded-md p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
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
