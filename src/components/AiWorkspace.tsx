"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Loader2, Mail, Send, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useComposerManager } from "@/lib/composer-manager";

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
  entityType: "client" | "candidate" | "job";
  entityId: string;
  title?: string;
  // When provided, assistant bubbles render an "Email" button that
  // pops the in-app composer pre-filled with this address and the
  // bubble's clean HTML as the body. Lets the recruiter ship a Game
  // Plan response straight out of Ace without copy / paste.
  recipientEmail?: string | null;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const TEMP_ID_PREFIX = "local-";

export function AiWorkspace({ entityType, entityId, title, recipientEmail }: AiWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

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
      const payload = (await res.json().catch(() => null)) as
        | { content?: string; error?: string }
        | null;
      if (!res.ok) {
        // Surface the real reason (Anthropic timeout, rate limit, etc.)
        // so we're not staring at a generic "try again" while the chat
        // silently dies on every send.
        const reason = payload?.error ?? `HTTP ${res.status}`;
        throw new Error(reason);
      }
      const content = payload?.content ?? "";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingAssistantId
            ? { ...m, content, createdAt: new Date().toISOString() }
            : m,
        ),
      );
    } catch (err) {
      // Drop the "Thinking…" bubble but keep the optimistic user message
      // visible so the recruiter can see what they sent + retry.
      setMessages((prev) => prev.filter((m) => m.id !== pendingAssistantId));
      const detail = err instanceof Error ? err.message : "unknown error";
      setErrorText(`Failed to send — ${detail}`);
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

  const emptyLabel =
    entityType === "client" ? "client" : entityType === "job" ? "job" : "candidate";

  return (
    // Sticky-footer chassis pattern-matched to the mail inline
    // composer: the card is `flex flex-col` with no fixed height,
    // the messages region caps at 55vh and scrolls internally, and
    // the composer is shrink-0 so it always stays pinned at the
    // bottom of the card without ever drifting below the viewport.
    // `sticky top-4` keeps the whole card on-screen while the parent
    // page scrolls behind it.
    //
    // Height cap: 100vh minus 20rem (320px). 20rem accounts for the
    // chrome above the card on the most-cramped Game Plan surface
    // (/candidates/[id]: topbar ~80px + name+contact header ~80px +
    // tabs row ~40px + action buttons row ~50px + outer page padding
    // ~70px). With this cap the composer + Send button stay inside
    // the viewport at top page scroll, no manual scroll needed.
    <div
      ref={cardRef}
      className="sticky top-4 flex max-h-[calc(100vh-20rem)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-court-border bg-white shadow-sm dark:bg-court-surface"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-court-border px-5 py-3">
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
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
        style={{ minHeight: "120px", maxHeight: "55vh" }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-court-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-center text-sm text-court-fg-muted">
            No conversation yet. Ask anything about this {emptyLabel}.
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                recipientEmail={recipientEmail ?? null}
                entityType={entityType}
                entityId={entityId}
                candidateRef={
                  entityType === "candidate" ? entityId : undefined
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-court-border bg-white p-4 dark:bg-court-surface">
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

function MessageBubble({
  message,
  recipientEmail,
  entityType,
  entityId,
  candidateRef,
}: {
  message: Message;
  recipientEmail: string | null;
  entityType: "client" | "candidate" | "job";
  entityId: string;
  candidateRef?: string;
}) {
  const isUser = message.role === "user";
  // Hide the copy affordance on the "Thinking…" placeholder — copying that
  // placeholder text is never useful and would just be noise while the
  // real response streams in.
  const showCopy = !isUser && message.content.trim().length > 0 && message.content !== "Thinking…";

  // Copy interceptor: when the recruiter selects an assistant bubble and
  // Cmd+C's it into Gmail / Outlook / etc., the browser would normally
  // serialize the selection with the bubble's computed styles
  // (bg-court-surface-subtle in particular). That painted a black
  // background onto the pasted email body and the destination's own
  // theme couldn't override it.
  //
  // We rewrite the clipboard payload here. If the user picked the whole
  // bubble (or nearly all of it), we hand over the full markdown source
  // converted to clean semantic HTML — same headings + bullets + links
  // as the rendered bubble but with zero classes / inline styles, so
  // Gmail can paint it on its own white canvas. For partial selections
  // we fall back to the selection toString (we can't infer which slice
  // of the source markdown the user selected).
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isUser) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    if (!e.clipboardData) return;
    const selected = selection.toString();
    // Heuristic: if the selection covers most of the rendered bubble
    // (within ~10% of the message length), assume the user wanted the
    // whole thing and use the full markdown source. Otherwise fall back
    // to a per-selection cleanup so we don't include text the user
    // didn't actually pick.
    const wholeBubble =
      selected.length >= Math.max(40, message.content.length * 0.7);
    if (wholeBubble) {
      e.clipboardData.setData("text/html", markdownToCleanHtml(message.content));
      e.clipboardData.setData(
        "text/plain",
        flattenMarkdownForClipboard(message.content),
      );
    } else {
      const range = selection.getRangeAt(0);
      const wrapper = document.createElement("div");
      wrapper.appendChild(range.cloneContents());
      wrapper.querySelectorAll("*").forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        el.removeAttribute("style");
        el.removeAttribute("class");
      });
      e.clipboardData.setData("text/html", wrapper.innerHTML);
      e.clipboardData.setData(
        "text/plain",
        flattenMarkdownForClipboard(selected),
      );
    }
    e.preventDefault();
  };

  return (
    <li className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        onCopy={onCopy}
        className={cn(
          "relative max-w-[75%] break-words rounded-2xl px-3 py-2 text-sm shadow-sm",
          isUser
            ? "bg-brand text-white"
            : "bg-gray-50 text-court-fg dark:bg-court-surface-subtle",
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
      {/* Per-bubble action row. Only on assistant bubbles, only when
          there's real content to send. The Email button always runs
          the bubble through /api/ai-workspace/format-email first, so
          the popup opens with a generated subject line and a clean
          candidate-ready body (greeting + content, no recruiter-side
          meta commentary, no "Want me to draft outreach?" trailing
          questions, no double signature). */}
      {!isUser && showCopy && recipientEmail && (
        <div className="mt-1 flex items-center gap-2">
          <EmailThisButton
            email={recipientEmail}
            entityType={entityType}
            entityId={entityId}
            candidateRef={candidateRef}
            content={message.content}
          />
        </div>
      )}
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
//
// Exported for reuse in the global Claude Panel so both surfaces render
// assistant content identically.
export function MarkdownContent({ content }: { content: string }) {
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

// Flatten Game Plan markdown into clean plaintext for the clipboard.
// Drops `### / ## / #` heading markers, `**bold**` / `*italic*` markers,
// normalizes bullets (`-`, `*`, `•`) to a clean `- `, collapses blank
// lines to single newlines, and converts `[text](url)` to `text - url`
// so a paste into Gmail / iMessage / SMS reads as formatted text and
// not as raw markdown punctuation.
export function flattenMarkdownForClipboard(input: string): string {
  let out = input.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, text: string, url: string) => `${text} - ${url}`,
  );
  // Strip leading heading markers.
  out = out.replace(/^#{1,6}\s+/gm, "");
  // Normalize bullets BEFORE italic strip so a "* item" line never
  // gets eaten by the italic regex.
  out = out.replace(/^[ \t]*[-*•]\s+/gm, "- ");
  // Bold before italic so a single `*` inside `**...**` doesn't trigger
  // the italic rule early.
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  // Italic — word-boundary-ish guards stop us from eating stray `*` in
  // URLs or unmatched single asterisks.
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2");
  // Collapse 2+ consecutive newlines (blank lines) to a single newline.
  out = out.replace(/\n{2,}/g, "\n");
  return out;
}

// Lightweight markdown → semantic HTML for clipboard payloads. Handles
// the cases Claude actually emits in the AI Workspace: links, bold,
// italic, headings, ordered + unordered lists, paragraphs, line breaks.
// Output uses zero classes / inline styles, so a paste into Gmail /
// Outlook / Word inherits the destination's theme — no dark background
// dragged along from the source bubble.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownInline(text: string): string {
  // Process inline markdown — link / bold / italic — on a single string.
  // The regex order matters: bold before italic (so **x** doesn't get
  // half-eaten by the italic rule), links last so the inner [text] hasn't
  // been touched yet.
  let out = text.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, inner) => `<strong>${escapeHtml(inner)}</strong>`,
  );
  out = out.replace(
    /(^|\W)\*([^*]+)\*(\W|$)/g,
    (_m, pre, inner, post) =>
      `${pre}<em>${escapeHtml(inner)}</em>${post}`,
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
  );
  // Auto-link bare URLs that aren't already wrapped in an anchor.
  out = out.replace(
    /(^|[\s])(https?:\/\/[^\s<]+)/g,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
  );
  return out;
}

export function markdownToCleanHtml(input: string): string {
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  // Running counter so consecutive `<ol>` blocks separated by paragraph
  // text continue numbering. Game Plan output puts a description
  // paragraph + an apply link between each numbered role, which forces
  // us to close the `<ol>` and reopen it when the next number arrives.
  // Without `start=`, every reopened `<ol>` restarted at 1 and the
  // candidate's email read "1. … 1. … 1. …". Reset to 0 only when we
  // hit a real section break (heading, `---`, or a bold "Section …" /
  // "Open Roles" / "Broader …" pseudo-header).
  let olCount = 0;
  const closeList = () => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, "");
    if (!line) {
      // Blank lines between list items are normal markdown — they
      // don't terminate the list.
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      olCount = 0;
      const level = heading[1].length;
      out.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      closeList();
      olCount = 0;
      out.push("<hr>");
      continue;
    }
    // Bold pseudo-header lines like `**Open Roles**` or
    // `**Broader job-board searches to watch**` mark the boundary
    // between Section 1 (numbered) and Section 2 (bullets), and they
    // mean the next `<ol>` should start fresh at 1.
    if (/^\*\*[^*]+\*\*\s*$/.test(line)) {
      closeList();
      olCount = 0;
      out.push(`<p>${renderMarkdownInline(line)}</p>`);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (listKind !== "ul") {
        closeList();
        out.push("<ul>");
        listKind = "ul";
      }
      out.push(`<li>${renderMarkdownInline(bullet[1])}</li>`);
      continue;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listKind !== "ol") {
        closeList();
        out.push(olCount > 0 ? `<ol start="${olCount + 1}">` : "<ol>");
        listKind = "ol";
      }
      out.push(`<li>${renderMarkdownInline(numbered[1])}</li>`);
      olCount++;
      continue;
    }
    closeList();
    out.push(`<p>${renderMarkdownInline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

// Ghost icon button pinned to the bottom-right of an assistant bubble.
// Copies the message after flattening markdown links to "text - url"
// form so a paste into iMessage / SMS / plaintext email leaves a bare
// URL the destination client can auto-linkify. Headers + bullet
// markers stay as-is — they're cosmetically harmless in plaintext and
// some clients still highlight them. Shows a checkmark for 2s on
// success.
export function CopyButton({ text }: { text: string }) {
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

// "Email this" button on assistant bubbles. Always runs the bubble
// through /api/ai-workspace/format-email before opening the composer
// so the popup gets a generated subject line and a candidate-ready
// body — never the raw bubble (which often contains "Want me to
// draft outreach?" / "Let me know which interests you" recruiter-side
// commentary). Andrew's signature is set up in Ace and is appended on
// send, so the format endpoint strips any trailing "Talk soon, Andrew
// Kraig / BreakPoint Talent" the model emitted to avoid double-signing.
export function EmailThisButton({
  email,
  entityType,
  entityId,
  candidateRef,
  content,
}: {
  email: string;
  // "panel" is the sentinel used by the global Claude Panel — no
  // entity context, so format-email skips the candidate lookup and
  // defaults the greeting to "Hi there,". The recruiter retypes the
  // recipient in the composer's To: field.
  entityType: "client" | "candidate" | "job" | "panel";
  entityId: string;
  candidateRef?: string;
  content: string;
}) {
  const composer = useComposerManager();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const [initRes, formatRes] = await Promise.all([
        fetch("/api/mail/compose-init"),
        fetch("/api/ai-workspace/format-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, entityId, content }),
        }),
      ]);
      if (!initRes.ok) {
        throw new Error(`compose-init failed (${initRes.status})`);
      }
      if (!formatRes.ok) {
        const errBody = await formatRes.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `format-email failed (${formatRes.status})`);
      }
      const init = (await initRes.json()) as {
        templates: import("@/app/email/actions").ActiveTemplateSummary[];
        user: { firstName: string; fullName: string };
      };
      const { subject, body } = (await formatRes.json()) as {
        subject: string;
        body: string;
      };
      composer.open({
        defaultTo: email,
        defaultSubject: subject,
        defaultBody: markdownToCleanHtml(body),
        templates: init.templates,
        mergeContext: {
          user: {
            firstName: init.user.firstName,
            fullName: init.user.fullName,
          },
        },
        candidateRef,
        nonBlocking: true,
      });
    } catch (err) {
      toast.error("Couldn't prep email", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Mail className="h-3 w-3" />
      )}
      {busy ? "Preparing…" : "Email this"}
    </button>
  );
}

export default AiWorkspace;
