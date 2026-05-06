"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Send, X } from "lucide-react";
import {
  CLAUDE_PANEL_MIN_H,
  CLAUDE_PANEL_MIN_W,
  useClaudePanel,
} from "@/lib/claude-panel-context";
import { Button } from "@/components/ui/button";

// Floating, draggable, resizable Claude chat panel. Mirrors the
// FloatingThreadWindow pattern: portal to document.body, GPU-composited
// drag via translate3d, will-change + CSS contain so layout/paint stay
// scoped to the panel itself. Default dock is bottom-right of the
// viewport at 420x560 (set in claude-panel-context).
//
// Phase 1 ships persistence + UI only. The send flow appends the user
// message to /api/claude-panel/messages then a placeholder assistant
// reply ("Claude integration coming in Phase 2.") so the recruiter can
// see the round-trip storing both sides cleanly. Phase 2 swaps that
// placeholder for an actual Anthropic call.

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const PLACEHOLDER_REPLY = "Claude integration coming in Phase 2.";

export function ClaudePanel() {
  const { open, position, size, close, setPosition, setSize } =
    useClaudePanel();

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

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const node = panelRef.current;
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
        nextW = Math.max(CLAUDE_PANEL_MIN_W, startW + ev.clientX - startPx);
        nextH = Math.max(CLAUDE_PANEL_MIN_H, startH + ev.clientY - startPy);
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
    },
    [size, setSize],
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
    // Optimistic user bubble — the persist call replaces the temp id
    // with the server-assigned cuid once it resolves.
    const tempUserId = `tmp-${Date.now()}`;
    const optimisticUser: Message = {
      id: tempUserId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    try {
      const userRow = await persist("user", text);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempUserId ? userRow : m)),
      );
      const assistantRow = await persist("assistant", PLACEHOLDER_REPLY);
      setMessages((prev) => [...prev, assistantRow]);
    } catch {
      // Roll back the optimistic bubble on failure so the user can retry
      // without a phantom message hanging in the panel.
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function clearChat() {
    if (clearing || messages.length === 0) return;
    setClearing(true);
    try {
      // Phase 1 has no DELETE endpoint yet — just blank the local view.
      // The persisted rows remain available; Phase 2 will add a true
      // clear when the assistant call lands.
      setMessages([]);
    } finally {
      setClearing(false);
    }
  }

  if (!mounted || !open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Claude chat"
      className="pointer-events-auto fixed z-[1000] flex flex-col overflow-hidden rounded-xl border border-court-border bg-court-surface shadow-2xl"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.w}px`,
        height: `${size.h}px`,
        contain: "layout paint",
      }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-court-border px-4 py-2 active:cursor-grabbing"
      >
        <div className="flex-1 font-serif text-base font-medium text-court-fg">
          Claude
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
            <div className="font-serif text-court-fg">Ask Claude anything.</div>
            <div className="text-xs">
              This panel is org-scoped and persists across pages.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl bg-court-brand px-3 py-2 text-sm text-white"
                    : "mr-auto max-w-[85%] rounded-2xl bg-court-surface-subtle px-3 py-2 text-sm text-court-fg"
                }
              >
                <div className="whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
            ))}
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
            placeholder="Message Claude…"
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
