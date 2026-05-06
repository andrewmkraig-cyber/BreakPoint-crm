"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import {
  CLAUDE_PANEL_MIN_H,
  CLAUDE_PANEL_MIN_W,
  useClaudePanel,
} from "@/lib/claude-panel-context";
import { useFloatingZ } from "@/lib/floating-z";
import { Button } from "@/components/ui/button";
import {
  CopyButton,
  EmailThisButton,
  MarkdownContent,
} from "@/components/AiWorkspace";

// Floating, draggable, resizable Claude chat panel. Mirrors the
// FloatingThreadWindow pattern: portal to document.body, GPU-composited
// drag via translate3d, will-change + CSS contain so layout/paint stay
// scoped to the panel itself. Default dock is bottom-right of the
// viewport at 420x560 (set in claude-panel-context).
//
// Send flow: persist the user turn to /api/claude-panel/messages,
// append an empty assistant bubble locally, stream tokens from
// /api/claude-panel/chat into that bubble, then persist the assembled
// assistant turn. The chat route is computation-only — persistence
// stays exclusively in /messages so a stream interruption can't leave
// half a row in Neon.

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

// Sentinel id assigned to the assistant bubble while it's streaming.
// Replaced with the persisted cuid once the final POST resolves.
const STREAMING_ID = "__streaming__";

export function ClaudePanel() {
  const { open, position, size, close, setPosition, setSize } =
    useClaudePanel();
  const { z, bringToFront } = useFloatingZ(open);

  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Hydrate transcript on first open. Cheap GET, no pagination — the
  // route caps at 100 rows. Re-running on every open keeps the panel in
  // sync if another tab on the same org has been chatting.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/claude-panel/messages", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Message[];
        if (!cancelled) setMessages(data);
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Auto-scroll to bottom on mount and whenever a new message lands.
  // listRef.scrollTop = scrollHeight is the cheapest way; behavior:
  // "smooth" feels laggy when the panel is already at-bottom.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  // Auto-grow the textarea up to ~6 rows. Reset to auto first so
  // shrinking on backspace works.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      const node = panelRef.current;
      if (!node || !position) return;
      const startPx = e.clientX;
      const startPy = e.clientY;
      const startX = position.x;
      const startY = position.y;
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
        node.style.transform = "";
        node.style.willChange = "";
        // Clamp to viewport so the panel can't be dragged off-screen.
        const maxX = Math.max(0, window.innerWidth - size.w);
        const maxY = Math.max(0, window.innerHeight - size.h);
        setPosition({
          x: Math.max(0, Math.min(maxX, startX + dx)),
          y: Math.max(0, Math.min(maxY, startY + dy)),
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [position, size, setPosition],
  );

  // Generic corner-resize handler. Each corner pins the OPPOSITE corner
  // and lets the dragged corner move — so a top-left drag grows the
  // panel up-and-left while the bottom-right corner stays put. Width
  // and height (and, for tl/bl, left/top) are mutated directly during
  // drag for the same GPU-friendly reason the BR-only handler used,
  // then committed to context state on pointerup so the next render
  // pins the new geometry via React style props.
  const onCornerPointerDown = useCallback(
    (corner: "tl" | "bl" | "br") =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const node = panelRef.current;
        if (!node || !position) return;
        const startPx = e.clientX;
        const startPy = e.clientY;
        const startW = size.w;
        const startH = size.h;
        const startX = position.x;
        const startY = position.y;
        let nextW = startW;
        let nextH = startH;
        let nextX = startX;
        let nextY = startY;
        let rafId = 0;
        node.style.willChange = "width, height, left, top";
        const flush = () => {
          rafId = 0;
          node.style.width = `${nextW}px`;
          node.style.height = `${nextH}px`;
          node.style.left = `${nextX}px`;
          node.style.top = `${nextY}px`;
        };
        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startPx;
          const dy = ev.clientY - startPy;
          if (corner === "br") {
            nextW = Math.max(CLAUDE_PANEL_MIN_W, startW + dx);
            nextH = Math.max(CLAUDE_PANEL_MIN_H, startH + dy);
          } else if (corner === "bl") {
            nextW = Math.max(CLAUDE_PANEL_MIN_W, startW - dx);
            nextH = Math.max(CLAUDE_PANEL_MIN_H, startH + dy);
            // Pin the right edge: left moves only by however much the
            // width actually changed (which the MIN_W clamp may shrink).
            nextX = startX + (startW - nextW);
          } else {
            // tl: pin the bottom-right corner.
            nextW = Math.max(CLAUDE_PANEL_MIN_W, startW - dx);
            nextH = Math.max(CLAUDE_PANEL_MIN_H, startH - dy);
            nextX = startX + (startW - nextW);
            nextY = startY + (startH - nextH);
          }
          if (rafId === 0) rafId = requestAnimationFrame(flush);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          if (rafId !== 0) cancelAnimationFrame(rafId);
          node.style.willChange = "";
          setSize({ w: nextW, h: nextH });
          setPosition({ x: nextX, y: nextY });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
    [position, size, setPosition, setSize],
  );

  async function persist(role: "user" | "assistant", content: string) {
    const res = await fetch("/api/claude-panel/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Message;
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    // Optimistic user bubble — replaced with the server-assigned cuid
    // once the /messages POST resolves.
    const tempUserId = `tmp-${Date.now()}`;
    const optimisticUser: Message = {
      id: tempUserId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    // Snapshot the prior history BEFORE adding the optimistic user
    // bubble so we can hand Claude a clean transcript ending in this
    // turn's user content (built below) without the temp row's
    // unsaved client-only id.
    const priorHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setMessages((prev) => [...prev, optimisticUser]);

    let userRow: Message;
    try {
      userRow = await persist("user", text);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempUserId ? userRow : m)),
      );
    } catch {
      // /messages POST failed — roll back the optimistic bubble and
      // restore the draft so the user can retry without losing input.
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      setDraft(text);
      setSending(false);
      return;
    }

    // Append a streaming-placeholder assistant bubble that the NDJSON
    // deltas accumulate into. The pulsing cursor lives inside this
    // bubble while id === STREAMING_ID; the swap to the persisted
    // cuid (or removal on error) hides the cursor.
    setMessages((prev) => [
      ...prev,
      {
        id: STREAMING_ID,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      },
    ]);

    let assembled = "";
    let streamErr: string | null = null;
    try {
      const res = await fetch("/api/claude-panel/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...priorHistory, { role: "user", content: text }],
        }),
      });
      if (!res.ok || !res.body) {
        let err = `Chat failed (${res.status})`;
        try {
          const j = await res.json();
          if (typeof j?.error === "string") err = j.error;
        } catch {
          // body wasn't JSON — keep the status-based error
        }
        throw new Error(err);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        let event: { t?: unknown; text?: unknown; error?: unknown };
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.t === "delta" && typeof event.text === "string") {
          assembled += event.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === STREAMING_ID ? { ...m, content: assembled } : m,
            ),
          );
        } else if (event.t === "error") {
          streamErr =
            typeof event.error === "string" ? event.error : "Stream error";
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handleLine(line);
        }
      }
      if (buffer.trim()) handleLine(buffer);
      if (streamErr) throw new Error(streamErr);
    } catch (e) {
      // Stream blew up — drop the empty assistant bubble and surface
      // the failure via toast. The user's persisted question stays so
      // they can retry without retyping; we deliberately don't keep
      // a partial / errored assistant turn in state because feeding
      // it back into the next request just makes Claude apologize
      // for an error it didn't produce.
      const message =
        e instanceof Error ? e.message : "Chat failed unexpectedly";
      setMessages((prev) => prev.filter((m) => m.id !== STREAMING_ID));
      toast.error("Ace couldn't respond", { description: message });
      setSending(false);
      return;
    }

    // Stream finished cleanly. Persist the full assembled content as
    // the assistant turn and swap the streaming bubble for the
    // persisted row so the next render's stable cuid drops the
    // pulsing cursor.
    try {
      const assistantRow = await persist("assistant", assembled);
      setMessages((prev) =>
        prev.map((m) => (m.id === STREAMING_ID ? assistantRow : m)),
      );
    } catch {
      // Stream succeeded but persistence failed — keep the bubble
      // visible with the assembled content but mark it as unsaved by
      // dropping the streaming sentinel. Next page load won't show
      // this turn; a subsequent send will continue cleanly.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === STREAMING_ID
            ? { ...m, id: `unsaved-${Date.now()}` }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  }

  async function clearChat() {
    if (clearing || messages.length === 0) return;
    setClearing(true);
    try {
      const res = await fetch("/api/claude-panel/messages", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessages([]);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Clear failed unexpectedly";
      toast.error("Couldn't clear chat", { description: message });
    } finally {
      setClearing(false);
    }
  }

  if (!mounted || !open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Ace Assistant"
      onPointerDownCapture={bringToFront}
      className="pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        zIndex: z,
        contain: "layout paint",
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-court-border px-4 py-2 active:cursor-grabbing"
      >
        <div className="flex-1 font-serif text-base font-medium text-court-fg">
          Ace Assistant
        </div>
        <button
          type="button"
          onClick={clearChat}
          disabled={clearing || messages.length === 0}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-50"
        >
          Clear chat
        </button>
        <button
          type="button"
          onClick={close}
          className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-court-fg-muted">
            <div className="font-serif text-court-fg">Ask Ace anything.</div>
            <div className="text-xs">
              This panel is org-scoped and persists across pages.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              const isStreaming = m.id === STREAMING_ID;
              const isUser = m.role === "user";
              const showActions = !isUser && !isStreaming && m.content.trim().length > 0;
              return (
                <div
                  key={m.id}
                  className={isUser ? "flex flex-col items-end" : "flex flex-col items-start"}
                >
                  <div
                    className={
                      (isUser
                        ? "ml-auto max-w-[85%] rounded-2xl bg-court-brand px-3 py-2 text-sm text-white"
                        : "relative mr-auto max-w-[85%] rounded-2xl bg-court-surface-subtle px-3 py-2 text-sm text-court-fg") +
                      (showActions ? " pb-7" : "")
                    }
                  >
                    {isUser ? (
                      <div className="whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                    ) : (
                      <>
                        <MarkdownContent content={m.content} />
                        {isStreaming && (
                          <span
                            aria-hidden="true"
                            className="ml-0.5 inline-block h-3.5 w-[2px] -translate-y-px animate-pulse bg-court-brand align-middle"
                          />
                        )}
                      </>
                    )}
                    {showActions && <CopyButton text={m.content} />}
                  </div>
                  {showActions && (
                    <div className="mt-1 flex items-center gap-2">
                      <EmailThisButton
                        email=""
                        entityType="panel"
                        entityId="global"
                        content={m.content}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-court-border bg-court-surface px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message Ace…"
            className="min-h-[44px] flex-1 resize-none rounded-md border border-court-border bg-court-surface-subtle px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted focus:border-court-accent focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send
          </Button>
        </div>
      </div>

      {/* Corner resize handles. TL pins the bottom-right corner, BL
          pins the top-right, BR pins the top-left (the original
          mail-thread behavior). Each handle stops propagation so the
          header drag handler can't fire from a corner click. */}
      <div
        onPointerDown={onCornerPointerDown("tl")}
        aria-label="Resize from top-left"
        className="absolute left-0 top-0 z-10 h-3.5 w-3.5 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(315deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
      <div
        onPointerDown={onCornerPointerDown("bl")}
        aria-label="Resize from bottom-left"
        className="absolute bottom-0 left-0 z-10 h-3.5 w-3.5 cursor-nesw-resize"
        style={{
          background:
            "linear-gradient(225deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
      <div
        onPointerDown={onCornerPointerDown("br")}
        aria-label="Resize from bottom-right"
        className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            "linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.18) 50%)",
        }}
      />
    </div>,
    document.body,
  );
}
