"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Hoists the floating YouTube panel's open/closed state up to Providers
// so it persists across page navigation. Mirrors ClaudePanelProvider:
// the panel itself reads from this context and renders via React portal
// at document.body. TopBar's play-icon button toggles `open`. Default
// dock is bottom-right of the viewport at 480x360.

const DEFAULT_W = 480;
const DEFAULT_H = 360;
const MIN_W = 320;
const MIN_H = 260;
// Distance from viewport edges when computing the default bottom-right
// dock. Matches the topbar's px-6 / page p-8 visual rhythm.
const EDGE_GAP = 24;

export type YouTubePanelPosition = { x: number; y: number };
export type YouTubePanelSize = { w: number; h: number };

type YouTubePanelCtx = {
  open: boolean;
  position: YouTubePanelPosition | null;
  size: YouTubePanelSize;
  toggle: () => void;
  close: () => void;
  setPosition: (next: YouTubePanelPosition) => void;
  setSize: (next: YouTubePanelSize) => void;
};

const Context = createContext<YouTubePanelCtx | null>(null);

export const YOUTUBE_PANEL_MIN_W = MIN_W;
export const YOUTUBE_PANEL_MIN_H = MIN_H;
export const YOUTUBE_PANEL_DEFAULT_W = DEFAULT_W;
export const YOUTUBE_PANEL_DEFAULT_H = DEFAULT_H;

export function YouTubePanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPositionState] = useState<YouTubePanelPosition | null>(
    null,
  );
  const [size, setSizeState] = useState<YouTubePanelSize>({
    w: DEFAULT_W,
    h: DEFAULT_H,
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== "undefined") {
        setPositionState((existing) => {
          if (existing) return existing;
          const x = Math.max(EDGE_GAP, window.innerWidth - DEFAULT_W - EDGE_GAP);
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

  const setPosition = useCallback((next: YouTubePanelPosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: YouTubePanelSize) => {
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

export function useYouTubePanel(): YouTubePanelCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useYouTubePanel must be used inside YouTubePanelProvider");
  }
  return ctx;
}
