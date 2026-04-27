"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// Hoists a single popped-out email thread up to the application shell
// so it survives navigation away from /mail. Mirrors the
// ComposerManager pattern: state lives at the Providers level, the
// FloatingThreadWindow component reads from this context and renders
// via React portal at the document body. Only one floating window is
// supported at a time — opening a new thread replaces the current
// floating window's threadId.

const DEFAULT_W = 680;
const DEFAULT_H = 520;
const MIN_W = 480;
const MIN_H = 400;

export type FloatingPosition = { x: number; y: number };
export type FloatingSize = { w: number; h: number };

type FloatingThreadCtx = {
  threadId: string | null;
  position: FloatingPosition | null;
  size: FloatingSize;
  open: (threadId: string) => void;
  close: () => void;
  setPosition: (next: FloatingPosition) => void;
  setSize: (next: FloatingSize) => void;
};

const Context = createContext<FloatingThreadCtx | null>(null);

export const FLOATING_THREAD_MIN_W = MIN_W;
export const FLOATING_THREAD_MIN_H = MIN_H;

export function FloatingThreadProvider({ children }: { children: ReactNode }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [position, setPositionState] = useState<FloatingPosition | null>(null);
  const [size, setSizeState] = useState<FloatingSize>({
    w: DEFAULT_W,
    h: DEFAULT_H,
  });

  const open = useCallback((id: string) => {
    if (typeof window !== "undefined") {
      // Center on first open. If a window is already open and the user
      // pops out a new thread, keep the existing position so they don't
      // lose their layout.
      setPositionState((prev) => {
        if (prev) return prev;
        const cx = Math.max(0, (window.innerWidth - DEFAULT_W) / 2);
        const cy = Math.max(0, (window.innerHeight - DEFAULT_H) / 2);
        return { x: cx, y: cy };
      });
    }
    setThreadId(id);
  }, []);

  const close = useCallback(() => {
    setThreadId(null);
  }, []);

  const setPosition = useCallback((next: FloatingPosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: FloatingSize) => {
    setSizeState({
      w: Math.max(MIN_W, next.w),
      h: Math.max(MIN_H, next.h),
    });
  }, []);

  return (
    <Context.Provider
      value={{ threadId, position, size, open, close, setPosition, setSize }}
    >
      {children}
    </Context.Provider>
  );
}

export function useFloatingThread(): FloatingThreadCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error(
      "useFloatingThread must be used inside FloatingThreadProvider",
    );
  }
  return ctx;
}
