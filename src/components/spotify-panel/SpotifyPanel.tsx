"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  Heart,
  Loader2,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  SPOTIFY_PANEL_MIN_H,
  SPOTIFY_PANEL_MIN_W,
  useSpotifyPanel,
} from "@/components/spotify-panel/SpotifyPanelProvider";
import { useFloatingZ } from "@/lib/floating-z";

// Floating Spotify panel modeled visually on the real Spotify
// product. The shell (drag header + resize corner + minimize dock)
// matches the YouTube panel; everything inside is Spotify-branded
// dark + green hex regardless of Court Mode, since the whole point
// of this surface is to feel like the actual app.
//
// Internal navigation is a manual view stack — clicking a playlist /
// album / artist pushes a frame, the back arrow pops. The persistent
// now-playing bar lives at the bottom of the body and renders as
// soon as a track loads, so it survives every view switch.
//
// Web Playback SDK is the audio engine. SDK script is loaded once
// per page; the player instance lives for the panel's lifetime so
// audio survives navigation + minimize. Premium is required for the
// /play call to succeed — free accounts authenticate and search
// fine, then 403 on play (we surface that as a toast).

// ──────────────────────────────────────────────────────────────────
// Types

type AuthState =
  | { status: "checking" }
  | { status: "unauthenticated" }
  | { status: "authenticated" };

type SearchTrack = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  durationMs: number;
  albumArt: string;
};
type SearchArtist = {
  id: string;
  uri: string;
  name: string;
  image: string;
};
type SearchAlbum = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  year: string;
  albumArt: string;
};
type SearchPlaylist = {
  id: string;
  uri: string;
  name: string;
  owner: string;
  image: string;
};
type SearchResults = {
  tracks: SearchTrack[];
  artists: SearchArtist[];
  albums: SearchAlbum[];
  playlists: SearchPlaylist[];
};

type RecentTrack = {
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumArt: string;
};
type Playlist = {
  id: string;
  uri: string;
  name: string;
  owner: string;
  image: string;
  trackCount: number;
};

type DetailTrack = {
  index: number;
  id: string;
  uri: string;
  name: string;
  artist: string;
  albumName: string;
  albumArt: string;
  durationMs: number;
};
type DetailPayload = {
  kind: "playlist" | "album";
  id: string;
  uri: string;
  name: string;
  description: string;
  image: string;
  owner: string;
  year: string;
  trackCount: number;
  tracks: DetailTrack[];
};

type LikedPayload = {
  total: number;
  tracks: DetailTrack[];
};

type ArtistPayload = {
  id: string;
  uri: string;
  name: string;
  image: string;
  followers: number;
  genres: string[];
  topTracks: {
    id: string;
    uri: string;
    name: string;
    durationMs: number;
    albumArt: string;
  }[];
  albums: {
    id: string;
    uri: string;
    name: string;
    year: string;
    albumArt: string;
  }[];
};

type View =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "playlist"; id: string; isAlbum?: boolean }
  | { kind: "liked" }
  | { kind: "artist"; id: string };

type ActiveTrack = {
  uri: string;
  name: string;
  artist: string;
  albumArt: string;
  durationMs: number;
};

type SpotifyPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  getCurrentState(): Promise<SpotifyPlayerState | null>;
  addListener(event: string, cb: (...args: unknown[]) => void): boolean;
  removeListener(event: string): void;
};
type SpotifyPlayerState = {
  paused?: boolean;
  position?: number;
  duration?: number;
  track_window?: {
    current_track?: {
      uri?: string;
      name?: string;
      duration_ms?: number;
      artists?: { name?: string }[];
      album?: { images?: { url?: string }[]; name?: string };
    };
  };
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

// ──────────────────────────────────────────────────────────────────
// Constants

const DOCK_W = 320;
const DOCK_H = 52;
const DOCK_EDGE_GAP = 24;
const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

// Spotify palette. Only the values referenced from inline `style`
// attributes are pulled out as constants — the rest live as literal
// Tailwind arbitrary values (`bg-[#181818]` etc.) at the call site
// for readability. Reference list:
//   #121212 — page bg (COLOR_BG)
//   #181818 — card bg
//   #282828 — card hover bg
//   #B3B3B3 — text secondary (COLOR_TEXT_SECONDARY)
//   #1DB954 — Spotify green (COLOR_GREEN)
//   #1ED760 — Spotify green hover
const COLOR_BG = "#121212";
const COLOR_TEXT_SECONDARY = "#B3B3B3";
const COLOR_GREEN = "#1DB954";

// ──────────────────────────────────────────────────────────────────
// Helpers

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTotalDuration(ms: number): string {
  if (!ms) return "";
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hr} hr` : `${hr} hr ${min} min`;
}

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ──────────────────────────────────────────────────────────────────
// Component

export function SpotifyPanel() {
  const { open, position, size, close, setPosition, setSize } =
    useSpotifyPanel();
  const { z, bringToFront } = useFloatingZ(open);

  const [mounted, setMounted] = useState(false);
  const [authState, setAuthState] = useState<AuthState>({ status: "checking" });
  const [minimized, setMinimized] = useState(false);

  // View navigation stack — top of stack is the visible view.
  const [stack, setStack] = useState<View[]>([{ kind: "home" }]);
  const view = stack[stack.length - 1];
  const goTo = useCallback(
    (next: View) => setStack((prev) => [...prev, next]),
    [],
  );
  const goBack = useCallback(
    () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev)),
    [],
  );
  const goHome = useCallback(() => setStack([{ kind: "home" }]), []);

  // Home-screen data (loaded once on first authenticated open).
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentTrack[] | null>(
    null,
  );
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [likedCount, setLikedCount] = useState<number | null>(null);

  // View-specific data caches.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [liked, setLiked] = useState<LikedPayload | null>(null);
  const [likedLoading, setLikedLoading] = useState(false);
  const [artist, setArtist] = useState<ArtistPayload | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);

  // Now-playing state.
  const [activeTrack, setActiveTrack] = useState<ActiveTrack | null>(null);
  const [paused, setPaused] = useState(true);
  const [position_ms, setPositionMs] = useState(0);
  const [volume, setVolume] = useState(50);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // ────────────────────────────────────────────────────────────────
  // Mount / auth

  useEffect(() => {
    setMounted(true);
  }, []);

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

  // ────────────────────────────────────────────────────────────────
  // SDK lifecycle

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
            .catch(() => {});
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
        const state = args[0] as SpotifyPlayerState | null | undefined;
        if (!state) return;
        setPaused(Boolean(state.paused));
        if (typeof state.position === "number") setPositionMs(state.position);
        const t = state.track_window?.current_track;
        if (t?.uri && t.name) {
          const albumImage = t.album?.images?.[0]?.url ?? "";
          setActiveTrack({
            uri: t.uri,
            name: t.name,
            artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(", "),
            albumArt: albumImage,
            durationMs: t.duration_ms ?? state.duration ?? 0,
          });
        }
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

  useEffect(() => {
    return () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
    };
  }, []);

  // Position polling — drives the progress bar between SDK state
  // events. Stopped while paused so we don't wake the tab unnecessarily.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setPositionMs((p) =>
        activeTrack ? Math.min(p + 1000, activeTrack.durationMs) : p,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [paused, activeTrack]);

  // ────────────────────────────────────────────────────────────────
  // Home data fetch

  useEffect(() => {
    if (authState.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      try {
        const [recentRes, playlistRes, likedRes] = await Promise.all([
          fetch("/api/spotify/recently-played", { cache: "no-store" }),
          fetch("/api/spotify/playlists", { cache: "no-store" }),
          fetch("/api/spotify/liked-songs", { cache: "no-store" }),
        ]);
        const recentJson = (await recentRes.json()) as {
          ok?: boolean;
          tracks?: RecentTrack[];
        };
        const playlistJson = (await playlistRes.json()) as {
          ok?: boolean;
          playlists?: Playlist[];
        };
        const likedJson = (await likedRes.json()) as {
          ok?: boolean;
          total?: number;
        };
        if (cancelled) return;
        if (recentJson.ok) setRecentlyPlayed(recentJson.tracks ?? []);
        if (playlistJson.ok) setPlaylists(playlistJson.playlists ?? []);
        if (likedJson.ok) setLikedCount(likedJson.total ?? 0);
      } catch {
        // home tiles render their own empty states; nothing to log.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authState.status]);

  // ────────────────────────────────────────────────────────────────
  // Per-view fetchers

  // Search debouncer — runs whenever the query input changes. 250ms
  // debounce keeps the request-per-keystroke load down without making
  // the recruiter wait. console.logs here are intentional — they're
  // the fastest way to confirm in the browser console that input is
  // firing the fetch and the API is returning rows.
  useEffect(() => {
    if (view.kind !== "search") return;
    const q = searchInput.trim();
    if (!q) {
      setSearchResults(null);
      setSearchQuery("");
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        console.log("[spotify-search] query:", q);
        try {
          const res = await fetch(
            `/api/spotify/search?q=${encodeURIComponent(q)}&types=track,artist,album,playlist`,
            { cache: "no-store" },
          );
          const json = (await res.json()) as {
            ok?: boolean;
            error?: string;
            tracks?: SearchTrack[];
            artists?: SearchArtist[];
            albums?: SearchAlbum[];
            playlists?: SearchPlaylist[];
          };
          console.log("[spotify-search] results:", json);
          if (res.status === 401) {
            setAuthState({ status: "unauthenticated" });
            return;
          }
          if (!res.ok || !json.ok) {
            toast.error("Spotify search failed", {
              description: json.error ?? `HTTP ${res.status}`,
            });
            return;
          }
          setSearchQuery(q);
          setSearchResults({
            tracks: json.tracks ?? [],
            artists: json.artists ?? [],
            albums: json.albums ?? [],
            playlists: json.playlists ?? [],
          });
        } catch (e) {
          console.error("[spotify-search] fetch failed:", e);
        } finally {
          setSearching(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [view.kind, searchInput]);

  // Detail (playlist/album) fetcher.
  useEffect(() => {
    if (view.kind !== "playlist") return;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    const isAlbum = view.isAlbum === true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/spotify/playlist-tracks/${encodeURIComponent(view.id)}${isAlbum ? "?kind=album" : ""}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as DetailPayload & {
          ok?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401) {
          setAuthState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok || !json.ok) {
          toast.error(`Couldn't load ${isAlbum ? "album" : "playlist"}`, {
            description: json.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        setDetail(json);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Liked songs fetcher.
  useEffect(() => {
    if (view.kind !== "liked") return;
    let cancelled = false;
    setLiked(null);
    setLikedLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/spotify/liked-songs", {
          cache: "no-store",
        });
        const json = (await res.json()) as LikedPayload & {
          ok?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401) {
          setAuthState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok || !json.ok) {
          toast.error("Couldn't load Liked Songs", {
            description: json.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        setLiked(json);
      } finally {
        if (!cancelled) setLikedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Artist fetcher.
  useEffect(() => {
    if (view.kind !== "artist") return;
    let cancelled = false;
    setArtist(null);
    setArtistLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/spotify/artist/${encodeURIComponent(view.id)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as ArtistPayload & {
          ok?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 401) {
          setAuthState({ status: "unauthenticated" });
          return;
        }
        if (!res.ok || !json.ok) {
          toast.error("Couldn't load artist", {
            description: json.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        setArtist(json);
      } finally {
        if (!cancelled) setArtistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Focus the search input when entering the search view.
  useEffect(() => {
    if (view.kind !== "search") return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [view.kind]);

  // ────────────────────────────────────────────────────────────────
  // Drag / resize / clamp (cloned from YouTubePanel)

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
      if ((e.target as HTMLElement).closest("input")) return;
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

  // ────────────────────────────────────────────────────────────────
  // Playback handlers

  const playBody = useCallback(
    async (body: object) => {
      const deviceId = deviceIdRef.current;
      if (!deviceId) {
        toast.error("Spotify player not ready", {
          description: "Wait a couple seconds for the player to connect.",
        });
        return;
      }
      try {
        const res = await fetch(
          `/api/spotify/play?device_id=${encodeURIComponent(deviceId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (res.status === 401) {
            setAuthState({ status: "unauthenticated" });
            return;
          }
          if (res.status === 502 && (json.error ?? "").includes("403")) {
            toast.error("Spotify Premium required", {
              description:
                "Full-track playback through the Web SDK needs a Premium account.",
            });
            return;
          }
          toast.error("Couldn't start playback", {
            description: json.error ?? `HTTP ${res.status}`,
          });
        }
      } catch (e) {
        toast.error("Couldn't start playback", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      }
    },
    [],
  );

  const playTrackList = useCallback(
    (uris: string[]) => playBody({ uris }),
    [playBody],
  );

  const playContext = useCallback(
    (contextUri: string, offsetUri?: string) => {
      const body: { context_uri: string; offset?: { uri: string } } = {
        context_uri: contextUri,
      };
      if (offsetUri) body.offset = { uri: offsetUri };
      return playBody(body);
    },
    [playBody],
  );

  const togglePlay = useCallback(async () => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    const endpoint = paused ? "play" : "pause";
    await fetch(
      `/api/spotify/${endpoint}?device_id=${encodeURIComponent(deviceId)}`,
      { method: "PUT" },
    );
  }, [paused]);

  const skipNext = useCallback(async () => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    await fetch(`/api/spotify/next?device_id=${encodeURIComponent(deviceId)}`, {
      method: "POST",
    });
  }, []);

  const skipPrev = useCallback(async () => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    await fetch(
      `/api/spotify/previous?device_id=${encodeURIComponent(deviceId)}`,
      { method: "POST" },
    );
  }, []);

  const seekTo = useCallback(async (ms: number) => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    setPositionMs(ms);
    await fetch(
      `/api/spotify/seek?position_ms=${Math.floor(ms)}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""}`,
      { method: "PUT" },
    );
  }, []);

  const setVolumePercent = useCallback(async (pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
    setVolume(clamped);
    const deviceId = deviceIdRef.current;
    await fetch(
      `/api/spotify/volume?volume_percent=${clamped}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ""}`,
      { method: "PUT" },
    );
  }, []);

  // Close fully tears down: pauses playback on Spotify's side, then
  // disconnects the SDK player so audio stops even if the pause
  // request races. Without this the panel hides but the Web Playback
  // SDK keeps streaming until the tab is closed. Minimize stays a
  // pure UI collapse — audio continues there by design.
  const handleClose = useCallback(() => {
    const deviceId = deviceIdRef.current;
    if (deviceId) {
      void fetch(
        `/api/spotify/pause?device_id=${encodeURIComponent(deviceId)}`,
        { method: "PUT" },
      ).catch(() => {});
    }
    if (playerRef.current) {
      try {
        playerRef.current.disconnect();
      } catch {}
      playerRef.current = null;
    }
    deviceIdRef.current = null;
    setActiveTrack(null);
    setPaused(true);
    // Reset auth state so the next open re-runs the auth check + SDK
    // init effects. Without this, reopening the panel would render
    // without a connected player because `authState.status` never
    // changed back through the "checking" → "authenticated" edge.
    setAuthState({ status: "checking" });
    close();
  }, [close]);

  // ────────────────────────────────────────────────────────────────
  // Render

  if (!mounted || !open || !position) return null;

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
        backgroundColor: COLOR_BG,
      }
    : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        zIndex: z,
        contain: "layout paint",
        backgroundColor: COLOR_BG,
      };

  // Minimized dock — same shape as the YouTube one but green-tinted
  // so the recruiter can tell at a glance which one is playing.
  if (minimized) {
    return createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Spotify"
        onPointerDownCapture={bringToFront}
        className="group pointer-events-auto fixed flex flex-col overflow-hidden rounded-lg shadow-2xl"
        style={rootStyle}
      >
        <div
          onPointerDown={onHeaderPointerDown}
          className="flex h-full cursor-grab select-none items-center gap-2 px-3 active:cursor-grabbing"
        >
          <Music className="h-4 w-4 shrink-0" style={{ color: COLOR_GREEN }} />
          <span
            title={
              activeTrack ? `${activeTrack.name} — ${activeTrack.artist}` : ""
            }
            className="flex-1 truncate text-xs font-medium text-white"
          >
            {activeTrack
              ? `${activeTrack.name} — ${activeTrack.artist}`
              : "Spotify"}
          </span>
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-md p-1 text-[#B3B3B3] transition hover:text-white"
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
            className="rounded-md p-1 text-[#B3B3B3] transition hover:text-white"
            aria-label="Restore panel"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-[#B3B3B3] transition hover:text-white"
            aria-label="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Spotify"
      onPointerDownCapture={bringToFront}
      className="group pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl text-white shadow-2xl"
      style={rootStyle}
    >
      {/* Drag header — slim, no Spotify branding (the body screams
          Spotify by itself). Houses Back, Search-from-anywhere
          shortcut, Minimize, Close. */}
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex h-9 shrink-0 cursor-grab select-none items-center gap-1 px-2 active:cursor-grabbing"
        style={{ backgroundColor: COLOR_BG }}
      >
        {stack.length > 1 ? (
          <button
            type="button"
            onClick={goBack}
            className="rounded-full p-1 text-white transition hover:bg-[#282828]"
            aria-label="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <div className="w-6" />
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="rounded-md p-1 text-[#B3B3B3] transition hover:text-white"
          aria-label="Minimize"
        >
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-md p-1 text-[#B3B3B3] transition hover:text-white"
          aria-label="Close panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body — auth-gated. Scrolls vertically. min-h-0 lets it
          shrink when NowPlayingBar wants more room; without it the
          body clamps to its content size and the album-art panel
          gets pushed off the bottom. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ backgroundColor: COLOR_BG }}
      >
        {authState.status === "checking" ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-[#B3B3B3]">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking Spotify…
          </div>
        ) : authState.status === "unauthenticated" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Music className="h-10 w-10" style={{ color: COLOR_GREEN }} />
            <div className="text-base font-semibold text-white">
              Connect your Spotify account
            </div>
            <p className="text-xs text-[#B3B3B3]">
              Premium is required for full-track playback through the Web
              Playback SDK.
            </p>
            <a
              href="/api/auth/spotify"
              className="mt-1 inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-black transition hover:scale-[1.02]"
              style={{ backgroundColor: COLOR_GREEN }}
            >
              Connect Spotify
            </a>
          </div>
        ) : view.kind === "home" ? (
          <HomeView
            recentlyPlayed={recentlyPlayed}
            playlists={playlists}
            likedCount={likedCount}
            onSearch={() => goTo({ kind: "search" })}
            onOpenPlaylist={(id) => goTo({ kind: "playlist", id })}
            onOpenLiked={() => goTo({ kind: "liked" })}
            onPlayTrack={(uri) => playTrackList([uri])}
          />
        ) : view.kind === "search" ? (
          <SearchView
            inputRef={searchInputRef}
            input={searchInput}
            setInput={setSearchInput}
            query={searchQuery}
            results={searchResults}
            searching={searching}
            onPlayTrack={(uri) => playTrackList([uri])}
            onOpenArtist={(id) => goTo({ kind: "artist", id })}
            onOpenAlbum={(id) =>
              goTo({ kind: "playlist", id, isAlbum: true })
            }
            onOpenPlaylist={(id) => goTo({ kind: "playlist", id })}
          />
        ) : view.kind === "playlist" ? (
          <PlaylistView
            detail={detail}
            loading={detailLoading}
            onPlayContext={playContext}
            onPlayTrack={(t) => {
              if (detail) playContext(detail.uri, t.uri);
            }}
          />
        ) : view.kind === "liked" ? (
          <LikedView
            data={liked}
            loading={likedLoading}
            onPlayAll={() =>
              liked && playTrackList(liked.tracks.map((t) => t.uri))
            }
            onPlayTrack={(t) =>
              liked &&
              playTrackList(
                liked.tracks
                  .slice(liked.tracks.findIndex((x) => x.uri === t.uri))
                  .map((x) => x.uri),
              )
            }
          />
        ) : view.kind === "artist" ? (
          <ArtistView
            data={artist}
            loading={artistLoading}
            onPlayArtist={(uri) => playContext(uri)}
            onPlayTrack={(uri) => playTrackList([uri])}
            onOpenAlbum={(id) =>
              goTo({ kind: "playlist", id, isAlbum: true })
            }
          />
        ) : null}
      </div>

      {/* Bottom of the panel stacks: BottomNav above NowPlayingBar,
          mirroring Spotify's mobile layout. Both are flex children
          so they take real layout space and content above never
          scrolls underneath them. */}
      {authState.status === "authenticated" && (
        <BottomNav
          view={view}
          onHome={goHome}
          onSearch={() => goTo({ kind: "search" })}
        />
      )}
      {activeTrack && (
        <NowPlayingBar
          track={activeTrack}
          paused={paused}
          positionMs={position_ms}
          volume={volume}
          onTogglePlay={togglePlay}
          onNext={skipNext}
          onPrev={skipPrev}
          onSeek={seekTo}
          onVolume={setVolumePercent}
        />
      )}

      <div
        onPointerDown={onCornerPointerDown}
        aria-label="Resize from bottom-right"
        className="absolute bottom-0 right-0 z-30 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.4) 50%)",
        }}
      />
    </div>,
    document.body,
  );
}

// ──────────────────────────────────────────────────────────────────
// Home

function HomeView(props: {
  recentlyPlayed: RecentTrack[] | null;
  playlists: Playlist[] | null;
  likedCount: number | null;
  onSearch: () => void;
  onOpenPlaylist: (id: string) => void;
  onOpenLiked: () => void;
  onPlayTrack: (uri: string) => void;
}) {
  const greeting = useMemo(timeOfDayGreeting, []);
  return (
    <div className="flex flex-col gap-5 px-4 pb-4 pt-3">
      <button
        type="button"
        onClick={props.onSearch}
        className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-[#B3B3B3] transition hover:text-white"
        style={{ backgroundColor: "#181818" }}
      >
        <Search className="h-4 w-4" />
        <span>What do you want to play?</span>
      </button>
      <div className="text-xl font-bold text-white">{greeting}</div>

      {props.recentlyPlayed === null ? (
        <RowSkeleton />
      ) : props.recentlyPlayed.length > 0 ? (
        <Section title="Recently Played">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {props.recentlyPlayed.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => props.onPlayTrack(t.uri)}
                className="group flex w-[120px] shrink-0 flex-col gap-2 rounded-md p-2 transition hover:bg-[#282828]"
              >
                {t.albumArt ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.albumArt}
                    alt=""
                    className="h-[100px] w-[100px] rounded object-cover shadow-md"
                  />
                ) : (
                  <div className="h-[100px] w-[100px] rounded bg-[#282828]" />
                )}
                <div className="line-clamp-2 text-left text-xs font-semibold text-white">
                  {t.name}
                </div>
                <div className="truncate text-[11px] text-[#B3B3B3]">
                  {t.artist}
                </div>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Your Library">
        <div className="grid grid-cols-2 gap-2">
          {/* Liked Songs special card — purple-blue gradient + heart. */}
          <button
            type="button"
            onClick={props.onOpenLiked}
            className="group flex aspect-square flex-col justify-end overflow-hidden rounded-md p-3 text-left transition hover:brightness-110"
            style={{
              background:
                "linear-gradient(135deg, #450AF5 0%, #8E8EE5 60%, #C4EFD9 100%)",
            }}
          >
            <Heart className="mb-2 h-6 w-6 text-white" fill="currentColor" />
            <div className="text-sm font-bold text-white">Liked Songs</div>
            <div className="text-xs text-white/80">
              {props.likedCount === null
                ? "—"
                : `${props.likedCount} ${props.likedCount === 1 ? "song" : "songs"}`}
            </div>
          </button>
          {props.playlists === null
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-md bg-[#181818]"
                />
              ))
            : props.playlists.slice(0, 11).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => props.onOpenPlaylist(p.id)}
                  className="group flex flex-col gap-1 rounded-md p-2 text-left transition hover:bg-[#282828]"
                >
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image}
                      alt=""
                      className="aspect-square w-full rounded object-cover shadow-md"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded bg-[#282828]" />
                  )}
                  <div className="line-clamp-1 text-xs font-semibold text-white">
                    {p.name}
                  </div>
                  <div className="truncate text-[11px] text-[#B3B3B3]">
                    {p.owner}
                  </div>
                </button>
              ))}
        </div>
      </Section>
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-base font-bold text-white">{props.title}</div>
      {props.children}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-[120px] w-[120px] shrink-0 animate-pulse rounded bg-[#181818]"
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Search

function SearchView(props: {
  inputRef: React.RefObject<HTMLInputElement>;
  input: string;
  setInput: (v: string) => void;
  query: string;
  results: SearchResults | null;
  searching: boolean;
  onPlayTrack: (uri: string) => void;
  onOpenArtist: (id: string) => void;
  onOpenAlbum: (id: string) => void;
  onOpenPlaylist: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5 px-4 pb-4 pt-2">
      <div
        className="flex items-center gap-2 rounded-md px-3 py-2"
        style={{ backgroundColor: "#242424" }}
      >
        <Search className="h-4 w-4 text-[#B3B3B3]" />
        <input
          ref={props.inputRef}
          type="search"
          value={props.input}
          onChange={(e) => props.setInput(e.target.value)}
          placeholder="What do you want to listen to?"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[#B3B3B3] focus:outline-none"
        />
        {props.searching && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B3B3B3]" />
        )}
      </div>

      {!props.query ? (
        <div className="text-xs text-[#B3B3B3]">
          Search for songs, artists, albums, or playlists.
        </div>
      ) : !props.results ? (
        <div className="flex items-center gap-2 text-sm text-[#B3B3B3]">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </div>
      ) : (
        <>
          {props.results.tracks.length > 0 && (
            <Section title="Songs">
              <ul className="flex flex-col">
                {props.results.tracks.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => props.onPlayTrack(t.uri)}
                      className="flex w-full items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
                    >
                      {t.albumArt ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.albumArt}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-[#282828]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {t.name}
                        </div>
                        <div className="truncate text-xs text-[#B3B3B3]">
                          {t.artist}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs tabular-nums text-[#B3B3B3]">
                        {formatDuration(t.durationMs)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {props.results.artists.length > 0 && (
            <Section title="Artists">
              <ul className="flex flex-col">
                {props.results.artists.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => props.onOpenArtist(a.id)}
                      className="flex w-full items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
                    >
                      {a.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.image}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded-full bg-[#282828]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {a.name}
                        </div>
                        <div className="text-xs text-[#B3B3B3]">Artist</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(props.results.albums.length > 0 ||
            props.results.playlists.length > 0) && (
            <Section title="Albums & Playlists">
              <ul className="flex flex-col">
                {props.results.albums.map((al) => (
                  <li key={`album-${al.id}`}>
                    <button
                      type="button"
                      onClick={() => props.onOpenAlbum(al.id)}
                      className="flex w-full items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
                    >
                      {al.albumArt ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={al.albumArt}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-[#282828]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {al.name}
                        </div>
                        <div className="truncate text-xs text-[#B3B3B3]">
                          {al.year ? `${al.year} • ` : ""}
                          {al.artist} • Album
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
                {props.results.playlists.map((pl) => (
                  <li key={`playlist-${pl.id}`}>
                    <button
                      type="button"
                      onClick={() => props.onOpenPlaylist(pl.id)}
                      className="flex w-full items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
                    >
                      {pl.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pl.image}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-[#282828]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {pl.name}
                        </div>
                        <div className="truncate text-xs text-[#B3B3B3]">
                          {pl.owner ? `${pl.owner} • ` : ""}Playlist
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {props.results.tracks.length === 0 &&
            props.results.artists.length === 0 &&
            props.results.albums.length === 0 &&
            props.results.playlists.length === 0 && (
              <div className="text-sm text-[#B3B3B3]">
                No results for &ldquo;{props.query}&rdquo;.
              </div>
            )}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Playlist / Album view

function PlaylistView(props: {
  detail: DetailPayload | null;
  loading: boolean;
  onPlayContext: (uri: string, offsetUri?: string) => void;
  onPlayTrack: (track: DetailTrack) => void;
}) {
  if (props.loading || !props.detail) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#B3B3B3]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  const d = props.detail;
  const totalDuration = d.tracks.reduce((acc, t) => acc + t.durationMs, 0);
  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <div className="flex items-end gap-3">
        {d.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.image}
            alt=""
            className="h-32 w-32 shrink-0 rounded object-cover shadow-2xl"
          />
        ) : (
          <div className="h-32 w-32 shrink-0 rounded bg-[#282828]" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
            {d.kind === "album" ? "Album" : "Playlist"}
          </div>
          <div className="line-clamp-2 text-xl font-bold text-white">
            {d.name}
          </div>
          {d.description && (
            <div
              className="line-clamp-2 text-xs text-[#B3B3B3]"
              dangerouslySetInnerHTML={{ __html: d.description }}
            />
          )}
          <div className="text-xs text-[#B3B3B3]">
            {d.owner && <span className="font-semibold text-white">{d.owner}</span>}
            {d.year ? ` • ${d.year}` : ""} • {d.trackCount} songs
            {totalDuration ? `, ${formatTotalDuration(totalDuration)}` : ""}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => props.onPlayContext(d.uri)}
        className="inline-flex w-fit items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.04]"
        style={{ backgroundColor: COLOR_GREEN }}
      >
        <Play className="h-4 w-4" fill="currentColor" /> Play
      </button>

      <ul className="flex flex-col">
        {d.tracks.map((t) => (
          <li key={`${t.index}-${t.id}`}>
            <button
              type="button"
              onClick={() => props.onPlayTrack(t)}
              className="grid w-full grid-cols-[24px_40px_1fr_auto] items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
            >
              <span className="text-right text-xs tabular-nums text-[#B3B3B3]">
                {t.index + 1}
              </span>
              {t.albumArt ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.albumArt}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded bg-[#282828]" />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">
                  {t.name}
                </div>
                <div className="truncate text-xs text-[#B3B3B3]">
                  {t.artist}
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-[#B3B3B3]">
                {formatDuration(t.durationMs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Liked Songs

function LikedView(props: {
  data: LikedPayload | null;
  loading: boolean;
  onPlayAll: () => void;
  onPlayTrack: (track: DetailTrack) => void;
}) {
  if (props.loading || !props.data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#B3B3B3]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  const total = props.data.total;
  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <div className="flex items-end gap-3">
        <div
          className="flex h-32 w-32 shrink-0 items-end justify-start rounded p-3 shadow-2xl"
          style={{
            background:
              "linear-gradient(135deg, #450AF5 0%, #8E8EE5 60%, #C4EFD9 100%)",
          }}
        >
          <Heart className="h-12 w-12 text-white" fill="currentColor" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/80">
            Playlist
          </div>
          <div className="text-xl font-bold text-white">Liked Songs</div>
          <div className="text-xs text-[#B3B3B3]">
            {total} {total === 1 ? "song" : "songs"}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={props.onPlayAll}
        className="inline-flex w-fit items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.04]"
        style={{ backgroundColor: COLOR_GREEN }}
      >
        <Play className="h-4 w-4" fill="currentColor" /> Play
      </button>

      <ul className="flex flex-col">
        {props.data.tracks.map((t, i) => (
          <li key={`${i}-${t.id}`}>
            <button
              type="button"
              onClick={() => props.onPlayTrack(t)}
              className="grid w-full grid-cols-[24px_40px_1fr_auto] items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
            >
              <span className="text-right text-xs tabular-nums text-[#B3B3B3]">
                {i + 1}
              </span>
              {t.albumArt ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.albumArt}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded bg-[#282828]" />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">
                  {t.name}
                </div>
                <div className="truncate text-xs text-[#B3B3B3]">
                  {t.artist}
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-[#B3B3B3]">
                {formatDuration(t.durationMs)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Artist

function ArtistView(props: {
  data: ArtistPayload | null;
  loading: boolean;
  onPlayArtist: (uri: string) => void;
  onPlayTrack: (uri: string) => void;
  onOpenAlbum: (id: string) => void;
}) {
  if (props.loading || !props.data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#B3B3B3]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  const a = props.data;
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-3">
      <div className="flex items-center gap-3">
        {a.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.image}
            alt=""
            className="h-24 w-24 shrink-0 rounded-full object-cover shadow-2xl"
          />
        ) : (
          <div className="h-24 w-24 shrink-0 rounded-full bg-[#282828]" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-xl font-bold text-white">{a.name}</div>
          <div className="text-xs text-[#B3B3B3]">
            {a.followers.toLocaleString()} followers
          </div>
          {a.genres.length > 0 && (
            <div className="text-xs italic text-[#B3B3B3]">
              {a.genres.join(", ")}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => props.onPlayArtist(a.uri)}
        className="inline-flex w-fit items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-black transition hover:scale-[1.04]"
        style={{ backgroundColor: COLOR_GREEN }}
      >
        <Play className="h-4 w-4" fill="currentColor" /> Play
      </button>

      {a.topTracks.length > 0 && (
        <Section title="Popular">
          <ul className="flex flex-col">
            {a.topTracks.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => props.onPlayTrack(t.uri)}
                  className="grid w-full grid-cols-[24px_40px_1fr_auto] items-center gap-3 rounded p-2 text-left transition hover:bg-[#282828]"
                >
                  <span className="text-right text-xs tabular-nums text-[#B3B3B3]">
                    {i + 1}
                  </span>
                  {t.albumArt ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.albumArt}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-[#282828]" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {t.name}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-[#B3B3B3]">
                    {formatDuration(t.durationMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {a.albums.length > 0 && (
        <Section title="Discography">
          <div className="grid grid-cols-2 gap-2">
            {a.albums.map((al) => (
              <button
                key={al.id}
                type="button"
                onClick={() => props.onOpenAlbum(al.id)}
                className="flex flex-col gap-1 rounded p-2 text-left transition hover:bg-[#282828]"
              >
                {al.albumArt ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={al.albumArt}
                    alt=""
                    className="aspect-square w-full rounded object-cover shadow-md"
                  />
                ) : (
                  <div className="aspect-square w-full rounded bg-[#282828]" />
                )}
                <div className="line-clamp-1 text-xs font-semibold text-white">
                  {al.name}
                </div>
                <div className="text-[11px] text-[#B3B3B3]">{al.year}</div>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Bottom Nav (Home / Search shortcuts)

function BottomNav(props: {
  view: View;
  onHome: () => void;
  onSearch: () => void;
}) {
  return (
    <nav
      className="flex shrink-0 items-center justify-around border-t border-white/5 px-2 py-1"
      style={{ backgroundColor: COLOR_BG }}
    >
      <button
        type="button"
        onClick={props.onHome}
        className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition"
        style={{
          color: props.view.kind === "home" ? "#fff" : COLOR_TEXT_SECONDARY,
        }}
        aria-label="Home"
      >
        <Music className="h-4 w-4" />
        Home
      </button>
      <button
        type="button"
        onClick={props.onSearch}
        className="flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition"
        style={{
          color: props.view.kind === "search" ? "#fff" : COLOR_TEXT_SECONDARY,
        }}
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
        Search
      </button>
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────
// Now Playing Bar

// Now Playing surface — when a track is loaded, the bottom of the
// panel turns into a Spotify-mobile-style "now playing" view: the
// album art takes the full panel width, the track name and artist
// are centered below it, then the scrubber, transport controls, and
// volume. The body content above scrolls under this; the recruiter
// can resize the panel taller to see more of it at once.
function NowPlayingBar(props: {
  track: ActiveTrack;
  paused: boolean;
  positionMs: number;
  volume: number;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (ms: number) => void;
  onVolume: (pct: number) => void;
}) {
  const dur = props.track.durationMs || 1;
  const pct = Math.min(100, Math.max(0, (props.positionMs / dur) * 100));

  function onProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    props.onSeek(Math.floor(ratio * dur));
  }

  return (
    // flex-[2_1_0] makes NowPlayingBar grow twice as fast as the body
    // above when the panel has spare height, so the album art gets
    // most of the room. min-h-[120px] keeps the controls block always
    // visible — at extreme small panel heights the album-art slot
    // collapses to 0 instead of pushing play/pause off the bottom.
    <div
      className="flex min-h-[120px] flex-[2_1_0] flex-col border-t border-white/10"
      style={{ backgroundColor: COLOR_BG }}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {props.track.albumArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.track.albumArt}
            alt=""
            className="block max-h-full max-w-full object-contain"
            style={{ aspectRatio: "1 / 1" }}
          />
        ) : (
          <div
            className="bg-[#282828]"
            style={{ aspectRatio: "1 / 1", height: "100%", maxWidth: "100%" }}
          />
        )}
      </div>

      <div className="shrink-0 px-4 pb-3 pt-3">
        <div className="truncate text-center text-base font-semibold text-white">
          {props.track.name}
        </div>
        <div className="mt-0.5 truncate text-center text-xs text-[#B3B3B3]">
          {props.track.artist}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="w-[34px] shrink-0 text-right text-[10px] tabular-nums text-[#B3B3B3]">
            {formatDuration(props.positionMs)}
          </span>
          <div
            onClick={onProgressClick}
            className="group relative h-1 flex-1 cursor-pointer rounded-full bg-[#4D4D4D]"
          >
            <div
              className="h-full rounded-full transition-[width] duration-100 group-hover:bg-[#1ED760]"
              style={{ width: `${pct}%`, backgroundColor: "#FFFFFF" }}
            />
          </div>
          <span className="w-[34px] shrink-0 text-[10px] tabular-nums text-[#B3B3B3]">
            {formatDuration(props.track.durationMs)}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#B3B3B3]" />
            <input
              type="range"
              min={0}
              max={100}
              value={props.volume}
              onChange={(e) => props.onVolume(Number(e.target.value))}
              aria-label="Volume"
              className="h-1 w-[72px] shrink-0 cursor-pointer accent-white"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={props.onPrev}
              className="rounded-full p-1 text-[#B3B3B3] transition hover:text-white"
              aria-label="Previous"
            >
              <SkipBack className="h-5 w-5" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={props.onTogglePlay}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
              aria-label={props.paused ? "Play" : "Pause"}
            >
              {props.paused ? (
                <Play className="h-4 w-4" fill="currentColor" />
              ) : (
                <Pause className="h-4 w-4" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={props.onNext}
              className="rounded-full p-1 text-[#B3B3B3] transition hover:text-white"
              aria-label="Next"
            >
              <SkipForward className="h-5 w-5" fill="currentColor" />
            </button>
          </div>
          <div className="w-[88px]" />
        </div>
      </div>
    </div>
  );
}

