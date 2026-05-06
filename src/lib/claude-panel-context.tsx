"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Hoists the global Claude Panel's open/closed state up to Providers
// so it persists across page navigation. Mirrors the FloatingThread
// pattern: the panel itself reads from this context and renders via
// React portal at document.body. TopBar's Sparkles button toggles
// `open`; closing keeps the panel out of the tree but the next mount
// rehydrates the transcript from /api/claude-panel/messages.

const DEFAULT_W = 420;
const DEFAULT_H = 560;
const MIN_W = 360;
const MIN_H = 360;
// Distance from viewport edges when computing the default bottom-right
// dock. Matches the topbar's px-6 / page p-8 visual rhythm.
const EDGE_GAP = 24;

export type ClaudePanelPosition = { x: number; y: number };
export type ClaudePanelSize = { w: number; h: number };

type ClaudePanelCtx = {
  open: boolean;
  position: ClaudePanelPosition | null;
  size: ClaudePanelSize;
  toggle: () => void;
  close: () => void;
  setPosition: (next: ClaudePanelPosition) => void;
  setSize: (next: ClaudePanelSize) => void;
};

const Context = createContext<ClaudePanelCtx | null>(null);

export const CLAUDE_PANEL_MIN_W = MIN_W;
export const CLAUDE_PANEL_MIN_H = MIN_H;
export const CLAUDE_PANEL_DEFAULT_W = DEFAULT_W;
export const CLAUDE_PANEL_DEFAULT_H = DEFAULT_H;

export function ClaudePanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPositionState] = useState<ClaudePanelPosition | null>(
    null,
  );
  const [size, setSizeState] = useState<ClaudePanelSize>({
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

  const setPosition = useCallback((next: ClaudePanelPosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: ClaudePanelSize) => {
    setSizeState({
      w: Math.max(MIN_W, next.w),
      h: Math.max(MIN_H, next.h),
    });
  }, []);

  return (
    <Context.Provider
      value={{ open, position, size, toggle, close, setPosition, setSize }}
    >
      {children}
    </Context.Provider>
  );
}

export function useClaudePanel(): ClaudePanelCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useClaudePanel must be used inside ClaudePanelProvider");
  }
  return ctx;
}
