"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

// Hoists the global Claude Panel's open/closed state up to Providers
// so it persists across page navigation. Mirrors the FloatingThread
// pattern: the panel itself reads from this context and renders via
// React portal at document.body. TopBar's Sparkles button toggles
// `open`; closing keeps the panel out of the tree but the next mount
// rehydrates the transcript from /api/claude-panel/messages.
//
// Phase 3: also derives the active page entity (candidate / client /
// job + id) from usePathname so the panel can pass that record's
// context to the chat route and show a name pill in the header.

const DEFAULT_W = 420;
const DEFAULT_H = 560;
const MIN_W = 360;
const MIN_H = 360;
// Distance from viewport edges when computing the default bottom-right
// dock. Matches the topbar's px-6 / page p-8 visual rhythm.
const EDGE_GAP = 24;

export type ClaudePanelPosition = { x: number; y: number };
export type ClaudePanelSize = { w: number; h: number };
export type ClaudePanelEntityType = "candidate" | "client" | "job";

type ClaudePanelCtx = {
  open: boolean;
  position: ClaudePanelPosition | null;
  size: ClaudePanelSize;
  entityType: ClaudePanelEntityType | null;
  entityId: string | null;
  toggle: () => void;
  close: () => void;
  setPosition: (next: ClaudePanelPosition) => void;
  setSize: (next: ClaudePanelSize) => void;
};

// Reserved children of /candidates, /clients, /jobs that aren't entity
// detail pages. Anything else after the section root is treated as an
// id (cuid or legacy numeric RF id — both shapes pass straight through
// to the build*Context resolvers).
const RESERVED_SEGMENTS = new Set(["new", "lists"]);

function deriveEntityFromPath(
  pathname: string | null,
): { entityType: ClaudePanelEntityType; entityId: string } | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/(candidates|clients|jobs)\/([^\/?#]+)/);
  if (!match) return null;
  const [, section, segment] = match;
  if (RESERVED_SEGMENTS.has(segment)) return null;
  const entityType: ClaudePanelEntityType =
    section === "candidates"
      ? "candidate"
      : section === "clients"
        ? "client"
        : "job";
  return { entityType, entityId: segment };
}

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

  // usePathname re-runs on every client navigation, so the derived
  // entity stays in sync with the URL automatically — no effect needed.
  const pathname = usePathname();
  const { entityType, entityId } = useMemo(() => {
    const derived = deriveEntityFromPath(pathname);
    return {
      entityType: derived?.entityType ?? null,
      entityId: derived?.entityId ?? null,
    };
  }, [pathname]);

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
      value={{
        open,
        position,
        size,
        entityType,
        entityId,
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

export function useClaudePanel(): ClaudePanelCtx {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useClaudePanel must be used inside ClaudePanelProvider");
  }
  return ctx;
}
