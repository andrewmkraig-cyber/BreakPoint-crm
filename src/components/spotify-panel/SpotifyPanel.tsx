"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Loader2,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  SPOTIFY_PANEL_MIN_H,
  SPOTIFY_PANEL_MIN_W,
  useSpotifyPanel,
} from "@/components/spotify-panel/SpotifyPanelProvider";
import { useFloatingZ } from "@/lib/floating-z";
import { Button } from "@/components/ui/button";

// Floating Spotify panel — same draggable/resizable shell as the
// YouTube panel with three visual states (search / playing /
// minimized) and the Web Playback SDK as the audio engine. The SDK
// script is injected once on first authenticated mount; the player
// instance lives for the panel's lifetime so audio survives
// search ↔ playing ↔ minimized transitions and only stops when the
// recruiter explicitly closes the panel.
//
// Premium Spotify is required by the SDK itself. Free accounts
// authenticate and search fine but the play call returns 403 — we
// surface that as a toast so the recruiter knows what's wrong.

type SearchResult = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumArt: string;
};

type AuthState =
  | { status: "checking" }
  | { status: "unauthenticated" }
  | { status: "authenticated" };

type ActiveTrack = {
  uri: string;
  name: string;
  artist: string;
  albumArt: string;
};

type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  togglePlay(): Promise<void>;
  addListener(event: string, cb: (...args: unknown[]) => void): boolean;
  removeListener(event: string): void;
};

declare global {
  interface Window {
    Spotify?: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const DOCK_W = 320;
const DOCK_H = 52;
const DOCK_EDGE_GAP = 24;
const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

export function SpotifyPanel() {
  const { open, position, size, close, setPosition, setSize } =
    useSpotifyPanel();
  const { z, bringToFront } = useFloatingZ(open);

  const [mounted, setMounted] = useState(false);
  const [authState, setAuthState] = useState<AuthState>({ status: "checking" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeTrack, setActiveTrack] = useState<ActiveTrack | null>(null);
  const [paused, setPaused] = useState(true);
  const [minimized, setMinimized] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auth probe runs whenever the panel is opened so the recruiter
  // sees fresh state after they finish the OAuth flow in another tab.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAuthState({ status: "checking" });
    fetch("/api/spotify/token", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean }) => {
        if (cancelled) return;
        setAuthState({ status: j.ok ? "authenticated" : "unauthenticated" });
      })
      .catch(() => {
        if (cancelled) return;
        setAuthState({ status: "unauthenticated" });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load the SDK + spin up the player exactly once, the first time
  // the recruiter is authenticated. The script tag is global so a
  // second panel mount finds window.Spotify already populated and
  // skips the network round-trip.
  useEffect(() => {
    if (authState.status !== "authenticated") return;
    if (playerRef.current) return;

    const init = () => {
      if (!window.Spotify) return;
      const player = new window.Spotify.Player({
        name: "Ace Spotify Panel",
        getOAuthToken: (cb) => {
          fetch("/api/spotify/token", { cache: "no-store" })
            .then((r) => r.json())
            .then((j: { ok?: boolean; access_token?: string }) => {
              if (j.ok && j.access_token) cb(j.access_token);
            })
            .catch(() => {
              // SDK retries on its own; nothing to do here.
            });
        },
        volume: 0.5,
      });

      player.addListener("ready", (...args: unknown[]) => {
        const evt = args[0] as { device_id?: string } | undefined;
        if (evt?.device_id) deviceIdRef.current = evt.device_id;
      });
      player.addListener("not_ready", () => {
        deviceIdRef.current = null;
      });
      player.addListener("player_state_changed", (...args: unknown[]) => {
        const state = args[0] as { paused?: boolean } | null | undefined;
        if (state) setPaused(Boolean(state.paused));
      });
      player.addListener("initialization_error", (...args: unknown[]) => {
        const e = args[0] as { message?: string } | undefined;
        console.error("[spotify] init error:", e?.message);
      });
      player.addListener("authentication_error", (...args: unknown[]) => {
        const e = args[0] as { message?: string } | undefined;
        console.error("[spotify] auth error:", e?.message);
        setAuthState({ status: "unauthenticated" });
      });
      player.addListener("account_error", (...args: unknown[]) => {
        const e = args[0] as { message?: string } | undefined;
        console.error("[spotify] account error:", e?.message);
        toast.error("Spotify Premium required", {
          description:
            "The Web Playback SDK only streams full tracks for Premium accounts.",
        });
      });

      void player.connect();
      playerRef.current = player;
    };

    if (window.Spotify) {
      init();
      return;
    }

    // Find an existing tag from a previous mount; otherwise inject.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SRC}"]`,
    );
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = SDK_SRC;
      tag.async = true;
      document.body.appendChild(tag);
    }
    window.onSpotifyWebPlaybackSDKReady = init;
  }, [authState.status]);

  // Tear down the player when the panel itself unmounts (provider is
  // root-level, so this only runs on full app teardown).
  useEffect(() => {
    return () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
    };
  }, []);

  // Same focus / minimize / clamp behaviors as the YouTube panel.
  useEffect(() => {
    if (!open) return;
    if (activeTrack) return;
    if (authState.status !== "authenticated") return;
    inputRef.current?.focus();
  }, [open, activeTrack, authState.status]);

  useEffect(() => {
    if (!activeTrack) setMinimized(false);
  }, [activeTrack]);

  useEffect(() => {
    if (!open) setMinimized(false);
  }, [open]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        nextW = Math.max(SPOTIFY_PANEL_MIN_W, startW + (ev.clientX - startPx));
        nextH = Math.max(SPOTIFY_PANEL_MIN_H, startH + (ev.clientY - startPy));
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
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: SearchResult[];
      };
      if (res.status === 401) {
        setAuthState({ status: "unauthenticated" });
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setResults(data.results ?? []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Search failed";
      toast.error("Spotify search failed", { description: message });
    } finally {
      setSearching(false);
    }
  }

  async function playTrack(r: SearchResult) {
    const deviceId = deviceIdRef.current;
    if (!deviceId) {
      toast.error("Spotify player not ready", {
        description: "Wait a couple seconds for the player to connect.",
      });
      return;
    }
    setActiveTrack({
      uri: r.uri,
      name: r.name,
      artist: r.artist,
      albumArt: r.albumArt,
    });
    try {
      const tokenRes = await fetch("/api/spotify/token", { cache: "no-store" });
      const tokenJson = (await tokenRes.json()) as {
        ok?: boolean;
        access_token?: string;
      };
      if (!tokenJson.ok || !tokenJson.access_token) {
        setAuthState({ status: "unauthenticated" });
        return;
      }
      const playRes = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tokenJson.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: [r.uri] }),
        },
      );
      if (!playRes.ok) {
        const text = await playRes.text();
        const detail = text.slice(0, 200);
        if (playRes.status === 403) {
          toast.error("Spotify Premium required", {
            description:
              "Full-track playback through the Web SDK needs a Premium account.",
          });
        } else {
          toast.error("Couldn't start playback", {
            description: `${playRes.status}: ${detail}`,
          });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Playback failed";
      toast.error("Couldn't start playback", { description: message });
    }
  }

  function backToSearch() {
    setActiveTrack(null);
    void playerRef.current?.togglePlay().catch(() => {
      // Ignore — toggling a non-active player throws and we just want
      // to stop audio when the recruiter goes back to search.
    });
  }

  function togglePlayback() {
    void playerRef.current?.togglePlay().catch((e) => {
      console.error("[spotify] togglePlay failed:", e);
    });
  }

  if (!mounted || !open || !position) return null;

  const playing = activeTrack !== null;

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
      aria-label="Spotify"
      onPointerDownCapture={bringToFront}
      className={
        "group pointer-events-auto fixed flex flex-col overflow-hidden border border-court-border bg-court-surface shadow-2xl " +
        (minimized ? "rounded-lg" : "rounded-xl")
      }
      style={rootStyle}
    >
      {/* PLAYING BACKDROP — full-bleed album art + readable bottom
          gradient. Stays mounted whenever activeTrack is set; in
          minimized mode the dock UI overlays it but the player keeps
          streaming because we never disconnect. */}
      {playing && activeTrack && (
        <div className="absolute inset-0 bg-black">
          {activeTrack.albumArt ? (
            // Plain <img>: art is a remote Spotify CDN URL pre-sized
            // by their server; next/image isn't worth the loader
            // configuration here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeTrack.albumArt}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-court-surface-subtle" />
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-12 text-white">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">
                {activeTrack.name}
              </div>
              <div className="truncate text-sm text-white/80">
                {activeTrack.artist}
              </div>
            </div>
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={paused ? "Play" : "Pause"}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/90"
            >
              {paused ? (
                <Play className="h-5 w-5" fill="currentColor" />
              ) : (
                <Pause className="h-5 w-5" fill="currentColor" />
              )}
            </button>
          </div>
        </div>
      )}

      {!playing ? (
        // SEARCH STATE — drag header + search bar + auth-gated body.
        <>
          <div
            onPointerDown={onHeaderPointerDown}
            className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-court-border bg-court-surface-subtle px-4 py-2 active:cursor-grabbing"
          >
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <span className="font-serif text-base font-medium text-court-fg">
                Spotify
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

          {authState.status === "checking" ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-court-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking Spotify…
            </div>
          ) : authState.status === "unauthenticated" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Music className="h-8 w-8 text-court-brand" />
              <div className="font-serif text-court-fg">
                Connect your Spotify account
              </div>
              <p className="text-xs text-court-fg-muted">
                Premium is required for full-track playback through the Web
                Playback SDK.
              </p>
              <a
                href="/api/auth/spotify"
                className="mt-1 inline-flex items-center gap-2 rounded-full bg-court-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-court-brand-dark"
              >
                Connect Spotify
              </a>
            </div>
          ) : (
            <>
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
                  placeholder="Search Spotify…"
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
                    <div className="font-serif text-court-fg">
                      Search Spotify.
                    </div>
                    <div className="text-xs">
                      Type a query and press Enter or click Search.
                    </div>
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => void playTrack(r)}
                          className="flex w-full items-start gap-3 px-3 py-2 text-left transition hover:bg-court-surface-subtle"
                        >
                          {r.albumArt ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.albumArt}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="h-14 w-14 shrink-0 rounded bg-court-surface-subtle" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-sm font-medium text-court-fg">
                              {r.name}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-court-fg-muted">
                              {r.artist}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      ) : minimized ? (
        // MINIMIZED STATE — slim dock with track + play/pause +
        // restore + close. Dock z-10 covers the album art beneath; the
        // SDK keeps streaming so audio is uninterrupted.
        <div
          onPointerDown={onHeaderPointerDown}
          className="absolute inset-0 z-10 flex cursor-grab select-none items-center gap-2 bg-court-surface px-3 active:cursor-grabbing"
        >
          <Music className="h-4 w-4 shrink-0 text-court-brand" />
          <span
            title={activeTrack ? `${activeTrack.name} — ${activeTrack.artist}` : ""}
            className="flex-1 truncate text-xs font-medium text-court-fg"
          >
            {activeTrack ? `${activeTrack.name} — ${activeTrack.artist}` : "Now playing"}
          </span>
          <button
            type="button"
            onClick={togglePlayback}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label={paused ? "Play" : "Pause"}
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" fill="currentColor" />
            ) : (
              <Pause className="h-3.5 w-3.5" fill="currentColor" />
            )}
          </button>
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
        // PLAYING STATE — hover-revealed top overlay, mirrors YT.
        <div
          onPointerDown={onHeaderPointerDown}
          className="absolute inset-x-0 top-0 z-10 flex h-9 cursor-grab select-none items-center gap-1 bg-black/70 px-3 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 active:cursor-grabbing"
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
