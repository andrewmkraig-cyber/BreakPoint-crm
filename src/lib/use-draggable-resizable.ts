"use client";

// Modal drag + resize hook (Ace 67.11 — 2026-05-27).
//
// Used by the two OfferDialog modals (RF <Modal> in placement-flows.tsx and
// Ace-native <ModalShell> in local-placement-rows.tsx) so the recruiter can
// drag the offer popup out of the way of the candidate row underneath and
// resize it to fit a wider salary / fee column without scrolling.
//
// CRITICAL clean release: setPointerCapture / releasePointerCapture on each
// gesture, plus onLostPointerCapture + onPointerCancel fallbacks so the
// gesture always ends the frame the pointer leaves the capturing element —
// no "stuck to cursor" drift if the user releases outside the viewport.
//
// Position is a translate3d offset from the panel's centered flex slot.
// Size is an inline width/height that overrides the default max-w-lg cap.
// Both states reset when the consumer modal unmounts (component lifecycle)
// so re-opening the dialog snaps back to centered + default size.

import { useCallback, useRef, useState } from "react";

export const MODAL_MIN_W = 480;
export const MODAL_MIN_H = 400;

type Position = { x: number; y: number };
type Size = { w: number | null; h: number | null };

type PointerHandlers = {
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  onLostPointerCapture?: React.PointerEventHandler<HTMLDivElement>;
};

export type DraggableResizable = {
  position: Position;
  size: Size;
  isDragging: boolean;
  isResizing: boolean;
  headerHandlers: PointerHandlers;
  resizeHandlers: PointerHandlers;
};

export function useDraggableResizable(opts: {
  enableDrag: boolean;
  enableResize: boolean;
  // Default width when resizable so the panel renders at the same visual
  // width the old max-w-lg / max-w-2xl Tailwind cap used to give it. Once
  // the user grabs the corner this gets overwritten by the explicit
  // resize delta.
  initialWidth?: number | null;
}): DraggableResizable {
  const { enableDrag, enableResize, initialWidth = null } = opts;
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [size, setSize] = useState<Size>({ w: initialWidth, h: null });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Refs hold the in-flight gesture's pointerId + base offsets so each
  // pointermove resolves the delta without depending on React state (state
  // updates batch — base values must be the values captured at pointerdown,
  // not whatever the render loop most recently committed).
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });
  const resizeRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    baseW: 0,
    baseH: 0,
    maxW: 0,
    maxH: 0,
  });

  // ---- Drag ----
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Pointer-down inside a <button> (the X close icon) must fall through
      // so the button's click still fires. closest() also covers any future
      // header buttons.
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX: position.x,
        baseY: position.y,
      };
      setIsDragging(true);
    },
    [position.x, position.y],
  );

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current.pointerId !== e.pointerId) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.baseX + dx,
        y: dragRef.current.baseY + dy,
      });
    },
    [],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // releasePointerCapture throws if the pointer is no longer captured —
      // safe to ignore; the gesture is already over.
    }
    dragRef.current.pointerId = -1;
    setIsDragging(false);
  }, []);

  // ---- Resize ----
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      // The handle is anchored to the panel, so parentElement is the panel
      // and its bounding rect gives us the current rendered size — which
      // matters when `size.w` / `size.h` haven't been written yet (first
      // resize gesture after open) and we'd otherwise snap to MIN.
      const rect = handle.parentElement?.getBoundingClientRect();
      handle.setPointerCapture(e.pointerId);
      resizeRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseW: rect?.width ?? size.w ?? MODAL_MIN_W,
        baseH: rect?.height ?? size.h ?? MODAL_MIN_H,
        maxW: window.innerWidth * 0.9,
        maxH: window.innerHeight * 0.9,
      };
      setIsResizing(true);
    },
    [size.w, size.h],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (resizeRef.current.pointerId !== e.pointerId) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const nextW = Math.max(
        MODAL_MIN_W,
        Math.min(resizeRef.current.maxW, resizeRef.current.baseW + dx),
      );
      const nextH = Math.max(
        MODAL_MIN_H,
        Math.min(resizeRef.current.maxH, resizeRef.current.baseH + dy),
      );
      setSize({ w: nextW, h: nextH });
    },
    [],
  );

  const endResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Same rationale as endDrag — already released, safe to ignore.
    }
    resizeRef.current.pointerId = -1;
    setIsResizing(false);
  }, []);

  return {
    position,
    size,
    isDragging,
    isResizing,
    headerHandlers: enableDrag
      ? {
          onPointerDown: onHeaderPointerDown,
          onPointerMove: onHeaderPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onLostPointerCapture: endDrag,
        }
      : {},
    resizeHandlers: enableResize
      ? {
          onPointerDown: onResizePointerDown,
          onPointerMove: onResizePointerMove,
          onPointerUp: endResize,
          onPointerCancel: endResize,
          onLostPointerCapture: endResize,
        }
      : {},
  };
}
