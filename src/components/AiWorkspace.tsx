"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, Loader2, Mail, Send, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmailPopupLauncher } from "@/components/email-popup-launcher";

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
        // Cap with maxHeight (not height) so an empty conversation
        // collapses to its content — keeps the textarea + Send button
        // visible above the fold instead of hanging at the bottom of
        // a near-full-viewport scroll container. A small minHeight
        // guarantees enough room for the empty-state copy + bubbles
        // while typing the first message.
        style={{
          minHeight: "120px",
          maxHeight: "calc(100vh - 380px)",
        }}
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
                candidateRef={
                  entityType === "candidate" ? entityId : undefined
                }
              />
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

function MessageBubble({
  message,
  recipientEmail,
  candidateRef,
}: {
  message: Message;
  recipientEmail: string | null;
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
      {/* Per-bubble action row. Only on assistant bubbles, only when
          there's real content to send. The Email button pops the in-app
          composer (non-blocking, so the user can keep navigating Ace)
          pre-filled with the bubble's clean HTML — links + bullets
          preserved, no theme baggage in the body. */}
      {!isUser && showCopy && recipientEmail && (() => {
        // Pre-process the bubble before handing it to the composer.
        // Claude's "draft an email" output looks like:
        //   Here's a clean email ready to send Danny:
        //   ---
        //   Subject: Strong Remote BA Opportunities Worth Your Time
        //   Hi Daniel,
        //   <body...>
        //   Talk soon,
        //   Andrew Kraig
        //   BreakPoint Talent
        //   ---
        //   Ready to copy and send to ...
        // We pull the Subject line into its own field, drop the
        // preamble + trailing footer + Andrew's signature (Gmail
        // appends one automatically), and pass only the greeting +
        // body to the composer.
        const { subject, body } = parseEmailFromMessage(message.content);
        return (
          <div className="mt-1 flex items-center gap-2">
            <EmailPopupLauncher
              email={recipientEmail}
              candidateRef={candidateRef}
              defaultSubject={subject ?? ""}
              defaultBody={markdownToCleanHtml(body)}
              className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:border-brand/40 hover:text-court-fg"
            >
              <Mail className="h-3 w-3" /> Email this
            </EmailPopupLauncher>
          </div>
        );
      })()}
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

function markdownToCleanHtml(input: string): string {
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  let listKind: "ul" | "ol" | null = null;
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
      // don't terminate the list. The earlier version closed the
      // <ol> on every blank, which produced a fresh <ol> per item
      // and rendered all six numbered jobs as "1." in the email
      // composer (each <ol> restarts at 1). Leave the active list
      // open; a real non-list line below closes it.
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
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
        out.push("<ol>");
        listKind = "ol";
      }
      out.push(`<li>${renderMarkdownInline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${renderMarkdownInline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

// Split a "draft an email" assistant bubble into Subject + Body for
// the composer. Strips: the lead-in line ("Here's a clean email ready
// to send X:"), `---` separator rules, the trailing "Ready to copy and
// send to ..." footer, and Andrew's signoff + signature block (Gmail
// appends a real signature on send, so dragging Claude's plaintext
// "Andrew Kraig / BreakPoint Talent" along would double-sign every
// email). If the bubble doesn't look like an email draft (no Subject:
// line) we hand the original content back unchanged so the composer
// still gets a usable body.
function parseEmailFromMessage(content: string): { subject: string | null; body: string } {
  const lines = content.split(/\r?\n/);
  let subjectIdx = -1;
  let subject: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*Subject:\s*(.+?)\s*$/i);
    if (m) {
      subject = m[1].trim();
      subjectIdx = i;
      break;
    }
  }
  if (subjectIdx < 0) return { subject: null, body: content };

  let bodyStart = subjectIdx + 1;
  let bodyEnd = lines.length;

  // Trailing "Ready to copy and send to <email>." footer.
  for (let i = bodyStart; i < lines.length; i++) {
    if (/^\s*Ready to copy and send/i.test(lines[i])) {
      bodyEnd = i;
      break;
    }
  }

  // Drop signoff + signature ("Talk soon," / "Best," / "Thanks," ...
  // followed by name + company on subsequent lines). Anchored to the
  // last few lines of the body window so we don't accidentally cut a
  // mid-email "Best of luck," sentence.
  const signoffRe =
    /^(thanks|thank you|best|best regards|regards|cheers|talk soon|warmly|sincerely|kind regards),?\s*$/i;
  for (let i = bodyEnd - 1; i >= bodyStart; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (signoffRe.test(t)) {
      bodyEnd = i;
      break;
    }
    // Stop walking back once we've passed a non-signoff non-empty
    // line — signoffs only live at the end of the message.
    break;
  }

  // Trim leading/trailing blank + `---` separator lines.
  const sepRe = /^-{2,}$/;
  while (
    bodyStart < bodyEnd &&
    (!lines[bodyStart].trim() || sepRe.test(lines[bodyStart].trim()))
  )
    bodyStart++;
  while (
    bodyEnd > bodyStart &&
    (!lines[bodyEnd - 1].trim() || sepRe.test(lines[bodyEnd - 1].trim()))
  )
    bodyEnd--;

  return { subject, body: lines.slice(bodyStart, bodyEnd).join("\n") };
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
