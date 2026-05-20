"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { ActiveTemplateSummary } from "@/app/email/actions";

// Hoists a single popped-out email thread up to the application shell
// so it survives navigation away from /mail. Mirrors the
// ComposerManager pattern: state lives at the Providers level, the
// FloatingThreadWindow component reads from this context and renders
// via React portal at the document body.
//
// The toolkit bundle is the data ThreadDetail needs to render fully
// (labels, templates, current user identity). MailView populates it
// at open() time so the floating window can keep working after the
// user navigates away from /mail.

const DEFAULT_W = 680;
const DEFAULT_H = 520;
const MIN_W = 480;
const MIN_H = 400;

export type FloatingPosition = { x: number; y: number };
export type FloatingSize = { w: number; h: number };

export type FloatingThreadToolkit = {
  labels: Array<{ id: string; name: string }> | null;
  templates: ActiveTemplateSummary[];
  currentUserEmail: string;
  currentUserFirstName: string;
  currentUserFullName: string;
};

export type FloatingThreadOpenOptions = {
  // When true, the popup renders only the latest message — used by the
  // new-mail notification toast so clicking View previews just the new
  // message, not the full thread history. Older messages stay queryable
  // for reply-target resolution but don't render.
  previewLatestOnly?: boolean;
  // When set, the popup opens straight into the composer in this mode
  // instead of read-only. Used by the new-mail notification toast's
  // Reply button so the cursor lands in the reply body immediately.
  // Cleared on close.
  composerMode?: "reply" | "replyAll" | "forward";
};

type FloatingThreadCtx = {
  threadId: string | null;
  toolkit: FloatingThreadToolkit | null;
  position: FloatingPosition | null;
  size: FloatingSize;
  minimized: boolean;
  previewLatestOnly: boolean;
  initialComposerMode: "reply" | "replyAll" | "forward" | null;
  open: (
    threadId: string,
    toolkit: FloatingThreadToolkit,
    options?: FloatingThreadOpenOptions,
  ) => void;
  close: () => void;
  setPosition: (next: FloatingPosition) => void;
  setSize: (next: FloatingSize) => void;
  setMinimized: (next: boolean) => void;
};

const Context = createContext<FloatingThreadCtx | null>(null);

export const FLOATING_THREAD_MIN_W = MIN_W;
export const FLOATING_THREAD_MIN_H = MIN_H;

export function FloatingThreadProvider({ children }: { children: ReactNode }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [toolkit, setToolkit] = useState<FloatingThreadToolkit | null>(null);
  const [position, setPositionState] = useState<FloatingPosition | null>(null);
  const [size, setSizeState] = useState<FloatingSize>({
    w: DEFAULT_W,
    h: DEFAULT_H,
  });
  const [minimized, setMinimizedState] = useState(false);
  const [previewLatestOnly, setPreviewLatestOnly] = useState(false);
  const [initialComposerMode, setInitialComposerMode] = useState<
    "reply" | "replyAll" | "forward" | null
  >(null);

  const open = useCallback(
    (
      id: string,
      kit: FloatingThreadToolkit,
      options?: FloatingThreadOpenOptions,
    ) => {
      if (typeof window !== "undefined") {
        setPositionState((prev) => {
          if (prev) return prev;
          const cx = Math.max(0, (window.innerWidth - DEFAULT_W) / 2);
          const cy = Math.max(0, (window.innerHeight - DEFAULT_H) / 2);
          return { x: cx, y: cy };
        });
      }
      setToolkit(kit);
      setThreadId(id);
      setMinimizedState(false);
      setPreviewLatestOnly(options?.previewLatestOnly ?? false);
      setInitialComposerMode(options?.composerMode ?? null);
    },
    [],
  );

  const close = useCallback(() => {
    setThreadId(null);
    setMinimizedState(false);
    setPreviewLatestOnly(false);
    setInitialComposerMode(null);
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

  const setMinimized = useCallback((next: boolean) => {
    setMinimizedState(next);
  }, []);

  return (
    <Context.Provider
      value={{
        threadId,
        toolkit,
        position,
        size,
        minimized,
        previewLatestOnly,
        initialComposerMode,
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

export function useFloatingThread(): FloatingThreadCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error(
      "useFloatingThread must be used inside FloatingThreadProvider",
    );
  }
  return ctx;
}
