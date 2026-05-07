"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, X, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  YOUTUBE_PANEL_MIN_H,
  YOUTUBE_PANEL_MIN_W,
  useYouTubePanel,
} from "@/components/youtube-panel/YouTubePanelProvider";
import { useFloatingZ } from "@/lib/floating-z";
import { Button } from "@/components/ui/button";

// Floating, draggable, resizable YouTube player panel. Mirrors the
// Ace Assistant (Claude) panel pattern: portal to document.body, GPU-
// composited drag via translate3d, will-change + CSS contain so layout
// /paint stay scoped to this panel. Default dock is bottom-right at
// 480x360 (set in YouTubePanelProvider).
//
// Search flow: on Search the panel POSTs to /api/youtube/search?q= so
// the YOUTUBE_API_KEY never reaches the client. Clicking a result
// embeds the YouTube iframe player. The "Back to results" button
// returns to the list without re-querying.

type SearchResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
};

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

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
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

  // Bottom-right corner resize handle. Mutates width/height directly
  // during drag for GPU-friendly perf, then commits to context state on
  // pointerup so the next render pins the new geometry.
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

  if (!mounted || !open || !position) return null;

  const showingPlayer = activeVideoId !== null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="YouTube"
      onPointerDownCapture={bringToFront}
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        zIndex: z,
        contain: "layout paint",
      }}
    >
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

      {showingPlayer ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mini results list collapses above the player so the user
              can pivot between hits without re-searching. */}
          <div className="shrink-0 border-b border-court-border bg-court-surface-subtle">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <button
                type="button"
                onClick={() => setActiveVideoId(null)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-court-fg-muted transition hover:bg-court-surface hover:text-court-fg"
              >
                <ArrowLeft className="h-3 w-3" /> Back to results
              </button>
            </div>
            <div className="max-h-20 overflow-y-auto px-2 pb-2">
              <ul className="flex flex-col gap-1">
                {results.map((r) => (
                  <li key={r.videoId}>
                    <button
                      type="button"
                      onClick={() => setActiveVideoId(r.videoId)}
                      className={
                        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition " +
                        (r.videoId === activeVideoId
                          ? "bg-court-brand-tint text-court-brand-dark"
                          : "text-court-fg hover:bg-court-surface")
                      }
                    >
                      <span className="truncate">{r.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex-1 bg-black">
            <iframe
              key={activeVideoId}
              src={`https://www.youtube.com/embed/${activeVideoId}?autoplay=1`}
              title="YouTube player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        </div>
      ) : (
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
                    onClick={() => setActiveVideoId(r.videoId)}
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
      )}

      <div
        onPointerDown={onCornerPointerDown}
        aria-label="Resize from bottom-right"
        className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
    </div>,
    document.body,
  );
}
