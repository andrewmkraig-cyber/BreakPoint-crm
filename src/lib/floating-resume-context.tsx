"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Hoists a single popped-out resume up to the application shell, the same
// way FloatingThreadProvider hoists a popped-out email. The inline resume
// viewer unmounts the moment the recruiter clicks over to Game Plan or
// Notes; held here, the floating copy survives that tab switch (and any
// other navigation) until it is closed.
//
// Split view: the candidate profile on /candidates and on a job's Matches
// tab renders inside a same-origin iframe. A window portaled inside that
// iframe could only move within the right-hand pane, so an embedded
// profile hands the open request up to the parent page with postMessage
// and the parent's provider renders the window over the whole screen.

export const FLOATING_RESUME_MIN_W = 320;
export const FLOATING_RESUME_MIN_H = 240;
// Floors for the opening size. Half the inline viewer lands near 400px on a
// laptop, where a letter page reads at roughly 60%; these keep the first
// view legible. Resizing can still take it smaller.
const OPEN_MIN_W = 440;
const OPEN_MIN_H = 420;
const EDGE_GAP = 24;
const TOP_OFFSET = 96;

const OPEN_MESSAGE = "ace:floating-resume:open";

export type FloatingResumePosition = { x: number; y: number };
export type FloatingResumeSize = { w: number; h: number };

export type FloatingResumeOpenInput = {
  // PDF bytes URL, the same one the inline viewer renders.
  src: string;
  // Window title, e.g. "Chomphel Norbu - Resume (Sep 10, 2026)".
  title: string;
  // Rendered width of the inline viewer at click time. The window opens at
  // half of it.
  sourceWidth: number;
};

type FloatingResumeCtx = {
  resume: { src: string; title: string } | null;
  position: FloatingResumePosition;
  size: FloatingResumeSize;
  minimized: boolean;
  open: (input: FloatingResumeOpenInput) => void;
  close: () => void;
  setPosition: (next: FloatingResumePosition) => void;
  setSize: (next: FloatingResumeSize) => void;
  setMinimized: (next: boolean) => void;
};

const Context = createContext<FloatingResumeCtx | null>(null);

// Only resume byte routes may be opened, so a stray same-origin message
// can't point the window at an arbitrary URL.
function isResumeSrc(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("/api/candidate-resumes/");
}

// True when this document sits inside an iframe on the same Ace origin (the
// split views). A cross-origin parent throws on .location, and the window
// then opens locally instead.
function hasSameOriginParent(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  try {
    return window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

// Keeps enough of the header on screen to grab it again: 80px of width at
// either edge, and the whole header row vertically.
export function clampFloatingResumePosition(
  pos: FloatingResumePosition,
  size: FloatingResumeSize,
): FloatingResumePosition {
  if (typeof window === "undefined") return pos;
  const grab = 80;
  return {
    x: Math.min(window.innerWidth - grab, Math.max(grab - size.w, pos.x)),
    y: Math.min(window.innerHeight - 40, Math.max(0, pos.y)),
  };
}

export function FloatingResumeProvider({ children }: { children: ReactNode }) {
  const [resume, setResume] = useState<{ src: string; title: string } | null>(null);
  const [position, setPositionState] = useState<FloatingResumePosition>({ x: 0, y: 0 });
  const [size, setSizeState] = useState<FloatingResumeSize>({
    w: OPEN_MIN_W,
    h: OPEN_MIN_H,
  });
  const [minimized, setMinimizedState] = useState(false);
  // Whether a window is currently open. Popping out a second resume while
  // one is showing swaps the document but keeps the spot and size the
  // recruiter already dragged it to.
  const isOpenRef = useRef(false);

  const openLocal = useCallback((input: FloatingResumeOpenInput) => {
    if (!isOpenRef.current) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.max(
        FLOATING_RESUME_MIN_W,
        Math.min(vw - EDGE_GAP * 2, Math.max(OPEN_MIN_W, Math.round(input.sourceWidth / 2))),
      );
      const h = Math.max(
        FLOATING_RESUME_MIN_H,
        Math.min(vh - TOP_OFFSET - EDGE_GAP, Math.max(OPEN_MIN_H, Math.round(vh / 2))),
      );
      setSizeState({ w, h });
      // Opens against the right edge, over the reference rail rather than
      // the Game Plan workspace the recruiter is about to use.
      setPositionState({ x: Math.max(0, vw - w - EDGE_GAP), y: TOP_OFFSET });
    }
    isOpenRef.current = true;
    setResume({ src: input.src, title: input.title });
    setMinimizedState(false);
  }, []);

  const open = useCallback(
    (input: FloatingResumeOpenInput) => {
      if (!isResumeSrc(input.src)) return;
      if (hasSameOriginParent()) {
        window.parent.postMessage(
          { type: OPEN_MESSAGE, ...input },
          window.location.origin,
        );
        return;
      }
      openLocal(input);
    },
    [openLocal],
  );

  // Receives open requests from an embedded profile. Routed back through
  // open() so a doubly-nested iframe keeps forwarding up to the top page.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as
        | { type?: unknown; src?: unknown; title?: unknown; sourceWidth?: unknown }
        | null;
      if (!data || data.type !== OPEN_MESSAGE || !isResumeSrc(data.src)) return;
      open({
        src: data.src,
        title: typeof data.title === "string" ? data.title : "Resume",
        sourceWidth: typeof data.sourceWidth === "number" ? data.sourceWidth : 0,
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open]);

  const close = useCallback(() => {
    isOpenRef.current = false;
    setResume(null);
    setMinimizedState(false);
  }, []);

  const setPosition = useCallback((next: FloatingResumePosition) => {
    setPositionState(next);
  }, []);

  const setSize = useCallback((next: FloatingResumeSize) => {
    setSizeState({
      w: Math.max(FLOATING_RESUME_MIN_W, next.w),
      h: Math.max(FLOATING_RESUME_MIN_H, next.h),
    });
  }, []);

  const setMinimized = useCallback((next: boolean) => {
    setMinimizedState(next);
  }, []);

  return (
    <Context.Provider
      value={{
        resume,
        position,
        size,
        minimized,
        open,
        close,
        setPosition,
        setSize,
        setMinimized,
      }}
    >
      {children}
    </Context.Provider>
  );
}

// Null outside the provider, so a caller can hide its pop-out button rather
// than crash.
export function useFloatingResume(): FloatingResumeCtx | null {
  return useContext(Context);
}
