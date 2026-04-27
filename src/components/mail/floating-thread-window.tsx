"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import {
  FLOATING_THREAD_MIN_H,
  FLOATING_THREAD_MIN_W,
  useFloatingThread,
} from "@/lib/floating-thread-context";
import { MessageBlock } from "@/components/mail/message-block";
import type { MailThreadDetail } from "@/lib/gmail";

// Portal-rendered draggable + resizable window for a single Gmail
// thread. Drag handler lives on the header bar; resize handler lives
// on a 16px square at the bottom-right corner. State is held in
// FloatingThreadContext so opening a new thread or navigating away
// from /mail doesn't unmount the window.

export function FloatingThreadWindow() {
  const { threadId, position, size, close, setPosition, setSize } =
    useFloatingThread();

  const [mounted, setMounted] = useState(false);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // createPortal needs document.body; gate until after mount so SSR
  // (and the initial server render of "use client" components) doesn't
  // try to access document.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Refetch the thread whenever the context's threadId changes.
  useEffect(() => {
    if (!threadId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/mail/threads/${encodeURIComponent(threadId)}`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => null)) as
          | MailThreadDetail
          | { error: string }
          | null;
        if (!res.ok) {
          if (!cancelled) {
            const msg =
              body && "error" in body ? body.error : `HTTP ${res.status}`;
            setError(msg);
          }
          return;
        }
        if (!cancelled) setDetail(body as MailThreadDetail);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "fetch failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Newest-first order — same as the inline ThreadDetail.
  const orderedMessages = useMemo(
    () => (detail ? [...detail.messages].reverse() : []),
    [detail],
  );

  if (!mounted || !threadId) return null;

  const pos = position ?? { x: 100, y: 100 };

  // Drag: pointer-down on header captures the deltas, window-level
  // pointermove/pointerup handle the rest. Avoiding setPointerCapture
  // because state-driven re-renders of the header element can swap
  // the captured target out from under us.
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const startPx = e.clientX;
    const startPy = e.clientY;
    const startX = pos.x;
    const startY = pos.y;
    const onMove = (ev: PointerEvent) => {
      setPosition({
        x: Math.max(0, startX + ev.clientX - startPx),
        y: Math.max(0, startY + ev.clientY - startPy),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resize: bottom-right corner only. Right + bottom edges grow with
  // the cursor. Min size enforced inside setSize.
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startPx = e.clientX;
    const startPy = e.clientY;
    const startW = size.w;
    const startH = size.h;
    const onMove = (ev: PointerEvent) => {
      setSize({
        w: Math.max(FLOATING_THREAD_MIN_W, startW + ev.clientX - startPx),
        h: Math.max(FLOATING_THREAD_MIN_H, startH + ev.clientY - startPy),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return createPortal(
    <div
      role="dialog"
      aria-label="Email thread"
      className="pointer-events-auto fixed z-[1000] flex flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex shrink-0 cursor-move select-none items-center justify-between gap-3 border-b border-court-border bg-court-surface-subtle px-4 py-2"
      >
        <div className="min-w-0 flex-1 truncate font-serif text-sm font-semibold text-court-fg">
          {detail?.subject ?? (loading ? "Loading…" : "Email")}
        </div>
        <button
          type="button"
          onClick={close}
          className="rounded p-1 text-court-fg-muted transition hover:bg-court-fg/5 hover:text-court-fg"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
          </div>
        )}
        {error && (
          <div className="p-5 text-sm text-red-700">
            <p className="font-medium">Couldn&rsquo;t load this thread.</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        )}
        {detail &&
          orderedMessages.map((m, i) => (
            <MessageBlock key={m.id} msg={m} isFirst={i === 0} />
          ))}
      </div>
      <div
        onPointerDown={onResizePointerDown}
        aria-label="Resize"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
    </div>,
    document.body,
  );
}
