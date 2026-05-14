"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  FolderInput,
  Forward,
  GripVertical,
  Loader2,
  Minus,
  Reply,
  ReplyAll,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  FLOATING_THREAD_MIN_H,
  FLOATING_THREAD_MIN_W,
  useFloatingThread,
} from "@/lib/floating-thread-context";
import { useFloatingZ } from "@/lib/floating-z";
import { useMailContext } from "@/lib/mail-context";
import {
  messageHasOtherRecipients,
  MoveToMenu,
  ThreadDetail,
} from "@/app/mail/mail-view";
import { mailToastIdForThread } from "@/components/mail-notification-toast";
import type { MailThreadDetail } from "@/lib/gmail";

// Portal-rendered draggable + resizable window for a single Gmail
// thread. Renders the same ThreadDetail component used inline in
// /mail with isFloating=true, so reply / archive / move-to all work
// from the popped-out window. The header bar mirrors the composer
// modal: GripVertical on the left, centered subject, Minus + X on
// the right.
//
// Drag handler lives on the header bar; resize handler lives on a
// 16px square at the bottom-right corner. State (threadId, position,
// size, minimized) is held in FloatingThreadContext so opening a new
// thread or navigating away from /mail doesn't unmount the window.

export function FloatingThreadWindow() {
  const {
    threadId,
    toolkit,
    position,
    size,
    minimized,
    previewLatestOnly,
    close,
    setPosition,
    setSize,
    setMinimized,
  } = useFloatingThread();
  // Click-to-front against Claude Panel and the modal MailComposer.
  // Active whenever a thread is loaded (threadId !== null) so opening
  // a popup from a notification toast brings it on top of whatever was
  // already floating.
  const { z: floatingZ, bringToFront } = useFloatingZ(threadId !== null);
  const { markThreadRead } = useMailContext();

  const [mounted, setMounted] = useState(false);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // composerMode lives here (not in ThreadDetail) so the action toolbar
  // can ride on this window's title bar instead of duplicating chrome
  // below it. Reset whenever the popup switches threads — same defense
  // ThreadDetail does internally for inline mode.
  const [composerMode, setComposerMode] = useState<
    null | "reply" | "replyAll" | "forward"
  >(null);
  useEffect(() => {
    setComposerMode(null);
  }, [threadId]);
  // When the user opens Reply / Reply All / Forward, expand the popup
  // to a height that leaves the editor body as the visual focal point.
  // The composer's chrome (To/CC/Subject/template+AI bar/format
  // toolbar/footer) is fixed-height; only height above that footprint
  // flows into the editor. Defaults at 520 squeezed it to a few lines.
  // Only bumps; never shrinks a popup the user manually grew.
  useEffect(() => {
    if (composerMode === null) return;
    const TARGET_H = 760;
    if (size.h < TARGET_H) {
      setSize({ w: size.w, h: TARGET_H });
    }
    // size/setSize are stable enough across renders that retriggering
    // on every resize would defeat the bump-once intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerMode]);
  const windowRef = useRef<HTMLDivElement | null>(null);

  // createPortal needs document.body; gate until after mount so SSR
  // (and the initial server render of "use client" components) doesn't
  // try to access document.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Refetch the thread whenever the context's threadId changes OR the
  // local reloadTick is bumped (e.g. after a successful reply send).
  useEffect(() => {
    if (!threadId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
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
        if (!cancelled) {
          setDetail(body as MailThreadDetail);
          // Mirror the Mail Tab's open-thread side effects so opening
          // from a notification toast (or any other entry point) marks
          // the thread read in Gmail and clears the unread badge / new-
          // mail toast for it. Fire-and-forget; failures must not block
          // the popup. Skipped on the reloadTick refresh path (e.g.
          // after a reply send) is harmless — the endpoints and the
          // optimistic clear are idempotent.
          markThreadRead(threadId);
          toast.dismiss(mailToastIdForThread(threadId));
          void fetch(
            `/api/mail/threads/${encodeURIComponent(threadId)}/read`,
            { method: "POST" },
          ).catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn("[mail] floating markThreadRead failed", err);
          });
        }
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
  }, [threadId, reloadTick, markThreadRead]);

  if (!mounted || !threadId || !toolkit) return null;

  const pos = position ?? { x: 100, y: 100 };

  // Drag: pointer-down on header captures the start state, window-level
  // pointermove/pointerup handle the rest.
  //
  // Perf: an earlier version mutated style.left / style.top directly on
  // every rAF tick. That works for small popups but on this one — which
  // contains a sanitized HTML email tree, often with multi-cell
  // signatures + inline images + a shadow-2xl drop shadow — every move
  // forced layout + paint of the entire subtree, so the drag visibly
  // lagged behind the cursor.
  //
  // Switched to CSS transform (translate3d): the popup keeps its
  // resolved left/top from React state, and the drag delta is applied
  // as a GPU-composited transform. The browser hands the element off
  // to its own compositor layer (will-change: transform), so dragging
  // skips layout + paint entirely and just moves a ready-baked layer.
  // On pointerup the transform is cleared and the new left/top is
  // committed to context state in a single render.
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const node = windowRef.current;
    if (!node) return;
    const startPx = e.clientX;
    const startPy = e.clientY;
    const startX = pos.x;
    const startY = pos.y;
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
      if (rafId !== 0) cancelAnimationFrame(rafId);
      // Clear the transform and commit the resolved position to state
      // so the next render pins the popup in its new spot via left/top.
      node.style.transform = "";
      node.style.willChange = "";
      setPosition({
        x: Math.max(0, startX + dx),
        y: Math.max(0, startY + dy),
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Resize fundamentally changes the box dimensions, so transform won't
  // help — children have to re-layout against the new constraints. We
  // still avoid React state churn by mutating width/height directly on
  // each rAF tick and committing to context state once on pointerup.
  // will-change: width/height hints the browser to optimize this path.
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = windowRef.current;
    if (!node) return;
    const startPx = e.clientX;
    const startPy = e.clientY;
    const startW = size.w;
    const startH = size.h;
    let nextW = startW;
    let nextH = startH;
    let rafId = 0;
    node.style.willChange = "width, height";
    const flush = () => {
      rafId = 0;
      node.style.width = `${nextW}px`;
      node.style.height = `${nextH}px`;
    };
    const onMove = (ev: PointerEvent) => {
      nextW = Math.max(FLOATING_THREAD_MIN_W, startW + ev.clientX - startPx);
      nextH = Math.max(FLOATING_THREAD_MIN_H, startH + ev.clientY - startPy);
      if (rafId === 0) rafId = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (rafId !== 0) cancelAnimationFrame(rafId);
      node.style.willChange = "";
      setSize({ w: nextW, h: nextH });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Local archive: hits the API, surfaces a toast, closes the
  // floating window on success. The inline /mail thread list won't
  // auto-update — user navigates back and refreshes if they want it
  // gone from the list.
  async function archiveCurrent() {
    if (!detail) return;
    setArchiving(true);
    try {
      const res = await fetch(
        `/api/mail/threads/${encodeURIComponent(detail.id)}/archive`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Couldn't archive", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Archived");
      close();
    } catch (e) {
      toast.error("Couldn't archive", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setArchiving(false);
    }
  }

  async function markUnreadCurrent() {
    if (!detail) return;
    setMarkingUnread(true);
    try {
      const res = await fetch(
        `/api/mail/threads/${encodeURIComponent(detail.id)}/unread`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Couldn't mark unread", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      toast.success("Marked unread");
      close();
    } catch (e) {
      toast.error("Couldn't mark unread", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setMarkingUnread(false);
    }
  }

  async function moveCurrent(labelId: string, labelName: string) {
    if (!detail) return;
    setMoving(true);
    try {
      const res = await fetch(
        `/api/mail/threads/${encodeURIComponent(detail.id)}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labelId }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Failed to move thread", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      toast.success(`Moved to ${labelName}`);
      close();
    } catch (e) {
      toast.error("Failed to move thread", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setMoving(false);
    }
  }

  // Selected-thread shape for ThreadDetail. The floating window is
  // opened by threadId only, so synthesize a minimal MailListThread
  // from the fetched detail's first message — it's only used for
  // computeReplyRecipients's fromEmail fallback.
  const selectedThreadShim = detail
    ? {
        id: detail.id,
        snippet: "",
        fromName: detail.messages[0]?.fromName ?? "",
        fromEmail: detail.messages[0]?.fromEmail ?? "",
        subject: detail.subject,
        timestampIso: detail.messages[0]?.dateIso ?? null,
        unread: false,
      }
    : null;

  // Effective height when minimized: just the header bar.
  const effectiveHeight = minimized ? 40 : size.h;

  // Reply All only renders when the latest message has at least one
  // other recipient — same DM-suppression rule the inline ThreadDetail
  // uses, recomputed here so the toolbar in this title bar can reflect
  // it without lifting more state. Cheap call, no memo needed (and a
  // useMemo here would sit after the early return above and break the
  // rules of hooks).
  const latestMessage = detail?.messages[detail.messages.length - 1];
  const showReplyAll = messageHasOtherRecipients(
    latestMessage,
    toolkit?.currentUserEmail ?? "",
  );
  const composerOpen = composerMode !== null;
  const actionsDisabled = !detail || composerOpen;

  return createPortal(
    <div
      ref={windowRef}
      role="dialog"
      aria-label="Email thread"
      onPointerDownCapture={bringToFront}
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${size.w}px`,
        height: `${effectiveHeight}px`,
        zIndex: floatingZ,
        // Confine layout/paint cost to inside the popup so a resize
        // doesn't have to consider any ancestor (CSS containment).
        // Big perf win when ThreadDetail's email body is dense.
        contain: "layout paint",
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-court-border px-3 py-1.5 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-court-fg-muted" />
        <div className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider text-court-fg-muted">
          {detail?.subject ?? (loading ? "Loading…" : "Email")}
        </div>
        {/* Action toolbar lives on the title-bar row instead of in
            ThreadDetail's own header — saves a chrome row and matches
            the user's "Reply / Reply All / Forward / Archive / Move To
            on the same line as pop out & x" request. Disabled while the
            composer is already open or the thread hasn't loaded. */}
        {!minimized && detail && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setComposerMode("reply")}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <Reply className="h-3 w-3" /> Reply
            </button>
            {showReplyAll && (
              <button
                type="button"
                onClick={() => setComposerMode("replyAll")}
                disabled={actionsDisabled}
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
              >
                <ReplyAll className="h-3 w-3" /> Reply All
              </button>
            )}
            <button
              type="button"
              onClick={() => setComposerMode("forward")}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              <Forward className="h-3 w-3" /> Forward
            </button>
            <button
              type="button"
              onClick={archiveCurrent}
              disabled={archiving || !detail}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg disabled:opacity-60"
            >
              {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
              Archive
            </button>
            <MoveToMenu
              labels={toolkit?.labels ?? null}
              busy={moving}
              onPick={moveCurrent}
              buttonContent={
                <>
                  {moving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FolderInput className="h-3 w-3" />
                  )}
                  Move To
                </>
              }
            />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setMinimized(!minimized)}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label={minimized ? "Restore" : "Minimize"}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {!minimized && (
        <>
          <div className="flex-1 overflow-hidden">
            {loading && !detail && (
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
            {detail && (
              <ThreadDetail
                detail={detail}
                selectedThread={selectedThreadShim}
                archiving={archiving}
                moving={moving}
                markingUnread={markingUnread}
                labels={toolkit.labels}
                currentUserEmail={toolkit.currentUserEmail}
                currentUserFirstName={toolkit.currentUserFirstName}
                currentUserFullName={toolkit.currentUserFullName}
                templates={toolkit.templates}
                onArchive={archiveCurrent}
                onMarkUnread={markUnreadCurrent}
                onMove={moveCurrent}
                onSent={() => {
                  setComposerMode(null);
                  setReloadTick((n) => n + 1);
                }}
                isFloating
                previewLatestOnly={previewLatestOnly}
                composerMode={composerMode}
                onComposerModeChange={setComposerMode}
              />
            )}
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
        </>
      )}
    </div>,
    document.body,
  );
}
