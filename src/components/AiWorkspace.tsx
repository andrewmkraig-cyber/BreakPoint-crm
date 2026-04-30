"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Loader2, Send, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Per-entity AI chat surface. Drops onto a client or candidate detail page
// as a standalone card: loads its own history from /api/ai-workspace,
// persists every turn through the same endpoint, and scopes itself by
// (entityType, entityId) so two candidates can't see each other's threads.
//
// Theming: every surface uses the court-* token namespace so Hard / Clay /
// Grass flip automatically. The user bubble stays literal brand-green
// (#5A9642 == bg-brand) in every mode because that's the Ace primary
// action color.

export type AiWorkspaceProps = {
  entityType: "client" | "candidate";
  entityId: string;
  title?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const TEMP_ID_PREFIX = "local-";

export function AiWorkspace({ entityType, entityId, title }: AiWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the bottom on every message-count change (and on load).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai-workspace?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const rows = (await res.json()) as Message[];
      setMessages(rows);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function onSend() {
    const text = input.trim();
    if (!text || sending) return;

    setErrorText(null);
    setSending(true);

    const now = new Date().toISOString();
    const optimisticUser: Message = {
      id: `${TEMP_ID_PREFIX}u-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: now,
    };
    const pendingAssistantId = `${TEMP_ID_PREFIX}a-${Date.now()}`;
    const pendingAssistant: Message = {
      id: pendingAssistantId,
      role: "assistant",
      content: "Thinking…",
      createdAt: now,
    };

    // Optimistic render: show user message + "Thinking…" assistant bubble
    // while the POST is in flight.
    setMessages((prev) => [...prev, optimisticUser, pendingAssistant]);
    setInput("");

    try {
      const res = await fetch("/api/ai-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId, userMessage: text }),
      });
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
      const { content } = (await res.json()) as { content: string };
      // Replace the "Thinking…" placeholder with the real assistant reply.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingAssistantId
            ? { ...m, content: content ?? "", createdAt: new Date().toISOString() }
            : m,
        ),
      );
    } catch {
      // Drop the "Thinking…" bubble but keep the optimistic user message
      // visible so the recruiter can see what they sent + retry.
      setMessages((prev) => prev.filter((m) => m.id !== pendingAssistantId));
      setErrorText("Failed to send - try again");
    } finally {
      setSending(false);
    }
  }

  async function onClear() {
    if (!confirm("Clear this conversation? This can't be undone.")) return;
    try {
      await fetch(
        `/api/ai-workspace?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
        { method: "DELETE" },
      );
    } catch {
      // Still clear locally — the server may have persisted partial state.
    }
    setMessages([]);
    setErrorText(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  }

  // Rows auto-expand between 2 and 6 based on the newline count in the
  // current input. Matches the user's spec: 2 rows default, 6 rows ceiling,
  // Enter sends, Shift+Enter newline.
  const rows = Math.min(6, Math.max(2, input.split("\n").length));

  const emptyLabel = entityType === "client" ? "client" : "candidate";

  return (
    <div className="flex flex-col rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-court-border px-5 py-3">
        <h2 className="font-serif text-base font-semibold text-court-fg">
          {title ?? "AI Workspace"}
        </h2>
        <button
          type="button"
          onClick={() => void onClear()}
          disabled={messages.length === 0 || sending}
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-red-300 hover:text-red-600 disabled:opacity-40"
          title="Clear this conversation"
        >
          <Trash2 className="h-3 w-3" /> Clear
        </button>
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto px-5 py-4"
        style={{ height: "calc(100vh - 380px)" }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-court-fg-muted">
            No conversation yet. Ask anything about this {emptyLabel}.
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-court-border p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={rows}
            placeholder={`Ask anything about this ${emptyLabel}…`}
            disabled={sending}
            className={cn(
              "flex-1 resize-none rounded-lg border border-court-border bg-court-surface-subtle/40 px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60",
              "focus:border-brand focus:bg-court-surface focus:outline-none focus:ring-2 focus:ring-brand/20",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
          <Button
            type="button"
            size="md"
            onClick={() => void onSend()}
            disabled={!input.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
        {errorText && (
          <div className="mt-2 text-xs text-red-600">{errorText}</div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  // Hide the copy affordance on the "Thinking…" placeholder — copying that
  // placeholder text is never useful and would just be noise while the
  // real response streams in.
  const showCopy = !isUser && message.content.trim().length > 0 && message.content !== "Thinking…";
  return (
    <li className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "relative max-w-[75%] break-words rounded-2xl px-3 py-2 text-sm shadow-sm",
          isUser
            ? "bg-brand text-white"
            : "bg-court-surface-subtle text-court-fg",
          // Extra bottom padding on assistant bubbles so the Copy button at
          // absolute bottom-right doesn't overlap the last line of text.
          showCopy && "pb-7",
        )}
      >
        {isUser ? (
          // User messages stay literal — no markdown parsing of recruiter
          // input. Whitespace + line breaks preserved with the same
          // splitter the bubble used to use for both roles.
          renderWithLineBreaks(message.content)
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {showCopy && <CopyButton text={message.content} />}
      </div>
      <div className="mt-1 text-[10px] text-court-fg-muted">
        {formatTimestamp(message.createdAt)}
      </div>
    </li>
  );
}

// Markdown renderer for assistant bubbles. react-markdown handles the
// link / bold / list / paragraph cases the system prompt asks Claude to
// emit; remark-gfm adds bare-URL autolinks and tables. Links are forced
// to open in a new tab with rel="noopener noreferrer" so a candidate
// page never gets navigated away when the recruiter clicks a job
// listing. Tailwind classes mirror the bubble's existing token palette
// — no global "prose" plugin needed for this scope.
function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="space-y-2 [&_p]:my-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_h1]:mt-2 [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-court-border/40 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              {...rest}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-court-accent-dark underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Flatten markdown links to "text - url" so a copy-paste survives into
// SMS / iMessage / plaintext email, where bare URLs auto-linkify but
// "[text](url)" syntax shows up as literal punctuation. Bold and list
// markers stay as-is — they're cosmetically harmless in plaintext.
function flattenMarkdownForClipboard(input: string): string {
  return input.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, text: string, url: string) => `${text} - ${url}`,
  );
}

// Ghost icon button pinned to the bottom-right of an assistant bubble.
// Copies the message after flattening markdown links to "text - url"
// form so a paste into iMessage / SMS / plaintext email leaves a bare
// URL the destination client can auto-linkify. Headers + bullet
// markers stay as-is — they're cosmetically harmless in plaintext and
// some clients still highlight them. Shows a checkmark for 2s on
// success.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(flattenMarkdownForClipboard(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in non-secure contexts or with permissions
      // denied. Silent fail is fine here — the UX still works on localhost
      // and the deployed HTTPS site, which are the only places Ace runs.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy to clipboard"}
      className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-court-fg-muted/70 transition hover:bg-court-border/40 hover:text-court-fg"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// Preserve hard newlines but don't parse markdown — spec said \n → <br>
// and nothing more. Rendered as fragments so React keeps its keying sane.
function renderWithLineBreaks(content: string): React.ReactNode {
  const parts = content.split("\n");
  return parts.map((line, idx) => (
    <span key={idx}>
      {line}
      {idx < parts.length - 1 && <br />}
    </span>
  ));
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
  } catch {
    return iso;
  }
}

export default AiWorkspace;
