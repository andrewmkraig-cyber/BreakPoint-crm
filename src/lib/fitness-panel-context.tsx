"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

const DEFAULT_W = 460;
const DEFAULT_H = 640;
const MIN_W = 300;
const MIN_H = 420;
const EDGE_GAP = 20;
const MOBILE_GAP = 8;
const MOBILE_MIN_H = 280;

export type FitnessPanelPosition = { x: number; y: number };
export type FitnessPanelSize = { w: number; h: number };

type FitnessPanelCtx = {
  open: boolean;
  minimized: boolean;
  position: FitnessPanelPosition | null;
  size: FitnessPanelSize;
  toggle: () => void;
  openPanel: () => void;
  close: () => void;
  minimize: () => void;
  restore: () => void;
  setPosition: (next: FitnessPanelPosition) => void;
  setSize: (next: FitnessPanelSize) => void;
};

const Context = createContext<FitnessPanelCtx | null>(null);

export const FITNESS_PANEL_MIN_W = MIN_W;
export const FITNESS_PANEL_MIN_H = MIN_H;
export const FITNESS_PANEL_DEFAULT_W = DEFAULT_W;
export const FITNESS_PANEL_DEFAULT_H = DEFAULT_H;

function defaultDock(): {
  position: FitnessPanelPosition;
  size: FitnessPanelSize;
} {
  if (typeof window === "undefined") {
    return {
      position: { x: EDGE_GAP, y: EDGE_GAP },
      size: { w: DEFAULT_W, h: DEFAULT_H },
    };
  }
  const viewportWidth = Math.floor(window.visualViewport?.width ?? window.innerWidth);
  const viewportHeight = Math.floor(
    window.visualViewport?.height ?? window.innerHeight,
  );
  const mobile = viewportWidth < 640;
  const w = mobile
    ? Math.max(280, viewportWidth - MOBILE_GAP * 2)
    : DEFAULT_W;
  const h = mobile
    ? Math.max(
        MOBILE_MIN_H,
        Math.min(MIN_H, viewportHeight - MOBILE_GAP * 2),
      )
    : Math.min(DEFAULT_H, viewportHeight - EDGE_GAP * 2);
  return {
    position: mobile
      ? { x: MOBILE_GAP, y: MOBILE_GAP }
      : {
          x: Math.max(EDGE_GAP, viewportWidth - w - EDGE_GAP),
          y: Math.max(EDGE_GAP, viewportHeight - h - EDGE_GAP),
        },
    size: { w, h },
  };
}

export function FitnessPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [position, setPositionState] = useState<FitnessPanelPosition | null>(
    null,
  );
  const [size, setSizeState] = useState<FitnessPanelSize>({
    w: DEFAULT_W,
    h: DEFAULT_H,
  });

  const ensureDock = useCallback(() => {
    setPositionState((existing) => {
      if (existing) return existing;
      const dock = defaultDock();
      setSizeState(dock.size);
      return dock.position;
    });
  }, []);

  const openPanel = useCallback(() => {
    ensureDock();
    setMinimized(false);
    setOpen(true);
  }, [ensureDock]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (prev && !minimized) {
        setMinimized(true);
        return true;
      }
      ensureDock();
      setMinimized(false);
      return true;
    });
  }, [ensureDock, minimized]);

  const close = useCallback(() => {
    setOpen(false);
    setMinimized(false);
  }, []);

  const minimize = useCallback(() => {
    setOpen(true);
    setMinimized(true);
  }, []);

  const restore = useCallback(() => {
    ensureDock();
    setOpen(true);
    setMinimized(false);
  }, [ensureDock]);

  const setPosition = useCallback((next: FitnessPanelPosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: FitnessPanelSize) => {
    setSizeState({
      w: Math.max(MIN_W, next.w),
      h: Math.max(MIN_H, next.h),
    });
  }, []);

  return (
    <Context.Provider
      value={{
        open,
        minimized,
        position,
        size,
        toggle,
        openPanel,
        close,
        minimize,
        restore,
        setPosition,
        setSize,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useFitnessPanel(): FitnessPanelCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useFitnessPanel must be used inside FitnessPanelProvider");
  }
  return ctx;
}
