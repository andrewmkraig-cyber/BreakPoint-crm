"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfCanvasViewer } from "@/components/pdf-canvas-viewer";
import {
  clampFloatingResumePosition,
  FLOATING_RESUME_MIN_H,
  FLOATING_RESUME_MIN_W,
  useFloatingResume,
} from "@/lib/floating-resume-context";
import { useFloatingZ } from "@/lib/floating-z";

// Portal-rendered draggable, resizable window showing one resume, opened
// from the pop-out button in the resume viewer's zoom bar. Built on the
// FloatingThreadWindow pattern: grip + title + Minimize + X in a header bar
// that drags, a 16px grip in the bottom-right corner that resizes, and
// state held in FloatingResumeProvider so the window stays up while the
// recruiter works the Game Plan tab.
//
// Below lg it renders as a full-screen sheet with no drag, resize or
// minimize, for the same reason the mail window does: a desktop-sized
// popup overflows a phone and strands its own X off-screen.

// Minimized height: the 40px header row plus the window's 1px top and
// bottom border (the root is border-box).
const MINIMIZED_H = 42;

export function FloatingResumeWindow() {
  const ctx = useFloatingResume();
  const resume = ctx?.resume ?? null;
  // Click-to-front against the mail window, Claude panel and composer.
  const { z: floatingZ, bringToFront } = useFloatingZ(resume !== null);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // createPortal needs document.body, so wait for the client mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (!mounted || !ctx || !resume) return null;
  const { position, size, minimized, close, setPosition, setSize, setMinimized } = ctx;

  // Drag moves a GPU-composited transform each frame and commits left/top
  // once on release, so the rendered PDF pages never re-layout mid-drag.
  // Pointer capture keeps the gesture alive when the cursor crosses the
  // candidate split-view iframe, which would otherwise swallow pointerup.
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const node = windowRef.current;
    if (!node) return;
    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      captureEl.setPointerCapture(pointerId);
    } catch {
      // Detached node - the window listeners below still end the gesture.
    }
    const startPx = e.clientX;
    const startPy = e.clientY;
    let dx = 0;
    let dy = 0;
    let rafId = 0;
    node.style.willChange = "transform";
    const flush = () => {
      rafId = 0;
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };
    const onMove = (ev: PointerEvent) => {
      dx = ev.clientX - startPx;
      dy = ev.clientY - startPy;
      if (rafId === 0) rafId = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        captureEl.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (rafId !== 0) cancelAnimationFrame(rafId);
      node.style.transform = "";
      node.style.willChange = "";
      setPosition(
        clampFloatingResumePosition({ x: position.x + dx, y: position.y + dy }, size),
      );
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // Resize writes width/height straight to the node each frame and commits
  // once on release. The body is pinned at its starting width for the
  // gesture: the viewer re-fits its pages to its own width, and letting it
  // see every intermediate width would repaint every page on every frame.
  // It re-fits once, on release.
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = windowRef.current;
    const body = bodyRef.current;
    if (!node || !body) return;
    const captureEl = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      captureEl.setPointerCapture(pointerId);
    } catch {
      /* detached node - fall back to window listeners */
    }
    const startPx = e.clientX;
    const startPy = e.clientY;
    const startW = size.w;
    const startH = size.h;
    // Never grow past the viewport's right or bottom edge.
    const maxW = window.innerWidth - position.x;
    const maxH = window.innerHeight - position.y;
    let nextW = startW;
    let nextH = startH;
    let rafId = 0;
    body.style.width = `${body.getBoundingClientRect().width}px`;
    node.style.willChange = "width, height";
    const flush = () => {
      rafId = 0;
      node.style.width = `${nextW}px`;
      node.style.height = `${nextH}px`;
    };
    const onMove = (ev: PointerEvent) => {
      nextW = Math.max(FLOATING_RESUME_MIN_W, Math.min(maxW, startW + ev.clientX - startPx));
      nextH = Math.max(FLOATING_RESUME_MIN_H, Math.min(maxH, startH + ev.clientY - startPy));
      if (rafId === 0) rafId = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        captureEl.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (rafId !== 0) cancelAnimationFrame(rafId);
      body.style.width = "";
      node.style.willChange = "";
      setSize({ w: nextW, h: nextH });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const containerStyle: React.CSSProperties = isMobile
    ? {
        left: "env(safe-area-inset-left, 0px)",
        top: "env(safe-area-inset-top, 0px)",
        width:
          "calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))",
        height:
          "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
        zIndex: floatingZ,
        contain: "layout paint",
      }
    : {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${minimized ? MINIMIZED_H : size.h}px`,
        zIndex: floatingZ,
        contain: "layout paint",
      };

  return createPortal(
    <div
      ref={windowRef}
      role="dialog"
      aria-label={`Resume: ${resume.title}`}
      onPointerDownCapture={bringToFront}
      className={
        "pointer-events-auto fixed flex flex-col overflow-hidden border border-court-border bg-court-surface shadow-2xl " +
        (isMobile ? "rounded-none" : "rounded-xl")
      }
      style={containerStyle}
    >
      <div
        onPointerDown={isMobile ? undefined : onHeaderPointerDown}
        className={
          "flex h-10 shrink-0 select-none items-center gap-2 border-b border-court-border px-3 " +
          (isMobile ? "" : "cursor-grab active:cursor-grabbing")
        }
      >
        {!isMobile && (
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
        )}
        <div
          className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-court-fg-muted"
          title={resume.title}
        >
          {resume.title}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isMobile && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMinimized(!minimized)}
              aria-label={minimized ? "Restore" : "Minimize"}
              title={minimized ? "Restore" : "Minimize"}
              className="h-7 w-7 p-0 shadow-none"
            >
              <Minus className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={close}
            aria-label="Close"
            title="Close"
            className="h-7 w-7 p-0 shadow-none"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* Stays mounted while minimized (the window collapses to its header
          around it) so restoring doesn't re-download and re-render the
          PDF. key={src} reloads it when a different resume is popped out. */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <PdfCanvasViewer key={resume.src} src={resume.src} className="min-h-0 flex-1" />
      </div>
      {!isMobile && !minimized && (
        <div
          onPointerDown={onResizePointerDown}
          aria-label="Resize"
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 50%, rgb(var(--court-fg-muted) / 0.35) 50%)",
          }}
        />
      )}
    </div>,
    document.body,
  );
}
