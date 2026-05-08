"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Hoists the floating Spotify panel's open/closed state up to
// Providers so it survives page navigation. Mirrors
// YouTubePanelProvider exactly — the panel itself reads from this
// context and renders via React portal at document.body. TopBar's
// Music-icon button toggles `open`. Default dock is bottom-right of
// the viewport at 480x360.

// 380×600 is a deliberate "tall narrow" footprint to mirror the
// real Spotify mobile/sidebar aesthetic — wide enough for a 2-col
// playlist grid + horizontal Recently Played row, tall enough that
// the persistent now-playing bar doesn't crowd out content above it.
const DEFAULT_W = 380;
const DEFAULT_H = 600;
const MIN_W = 320;
const MIN_H = 400;
const EDGE_GAP = 24;

export type SpotifyPanelPosition = { x: number; y: number };
export type SpotifyPanelSize = { w: number; h: number };

type SpotifyPanelCtx = {
  open: boolean;
  position: SpotifyPanelPosition | null;
  size: SpotifyPanelSize;
  toggle: () => void;
  close: () => void;
  setPosition: (next: SpotifyPanelPosition) => void;
  setSize: (next: SpotifyPanelSize) => void;
};

const Context = createContext<SpotifyPanelCtx | null>(null);

export const SPOTIFY_PANEL_MIN_W = MIN_W;
export const SPOTIFY_PANEL_MIN_H = MIN_H;
export const SPOTIFY_PANEL_DEFAULT_W = DEFAULT_W;
export const SPOTIFY_PANEL_DEFAULT_H = DEFAULT_H;

export function SpotifyPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPositionState] = useState<SpotifyPanelPosition | null>(
    null,
  );
  const [size, setSizeState] = useState<SpotifyPanelSize>({
    w: DEFAULT_W,
    h: DEFAULT_H,
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== "undefined") {
        setPositionState((existing) => {
          if (existing) return existing;
          const x = Math.max(
            EDGE_GAP,
            window.innerWidth - DEFAULT_W - EDGE_GAP,
          );
          const y = Math.max(
            EDGE_GAP,
            window.innerHeight - DEFAULT_H - EDGE_GAP,
          );
          return { x, y };
        });
      }
      return next;
    });
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const setPosition = useCallback((next: SpotifyPanelPosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: SpotifyPanelSize) => {
    setSizeState({
      w: Math.max(MIN_W, next.w),
      h: Math.max(MIN_H, next.h),
    });
  }, []);

  return (
    <Context.Provider
      value={{
        open,
        position,
        size,
        toggle,
        close,
        setPosition,
        setSize,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useSpotifyPanel(): SpotifyPanelCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useSpotifyPanel must be used inside SpotifyPanelProvider");
  }
  return ctx;
}
