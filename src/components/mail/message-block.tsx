"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, Forward, Reply, ReplyAll } from "lucide-react";
import type { MailThreadMessage } from "@/lib/gmail";
import { EmailHtmlViewer } from "@/components/mail/email-html-viewer";

export type MessageBlockAction = "reply" | "replyAll" | "forward";

// Strip HTML tags + collapse whitespace so we can derive a one-line
// preview snippet for the collapsed-row state. The body is already
// sanitized server-side, so we're only concerned with stripping markup
// for display, not security. Falls back to "(no preview)" when the
// stripped body is empty (e.g. attachment-only messages).
function snippetFromBody(html: string, maxLen = 100): string {
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "(no preview)";
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen)}…` : stripped;
}

function shortTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Today → "9:42 AM"; otherwise "May 6"
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Single message renderer used by both the inline Mail Tab thread
// pane and the popped-out FloatingThreadWindow. Body HTML is already
// sanitized by the /api/mail/threads/[id] route — safe to render via
// dangerouslySetInnerHTML here.
//
// Earlier this component leaned on Tailwind's `prose` class for
// typography, but @tailwindcss/typography isn't installed on this
// project — so `prose` was a no-op and HTML emails rendered with
// zero spacing, no list bullets, no link colors, etc. The result
// read as unformatted plain text. The arbitrary-children selectors
// below give the rendered email body explicit defaults for the tags
// the API sanitizer lets through (p / br / ul / ol / li / strong /
// em / a / blockquote / pre / h1-3 / img). Court tokens drive every
// color so the body tracks the active mode.
//
// Gmail-style collapse rule:
//   isLatest=true  → always render the full body, no toggle.
//   isLatest=false → render a single one-line summary div (sender,
//                    100-char snippet, short date). Click expands it
//                    via local showFull state.
export function MessageBlock({
  msg,
  isFirst,
  onAction,
  showReplyAll = true,
  isLatest,
}: {
  msg: MailThreadMessage;
  isFirst: boolean;
  onAction?: (mode: MessageBlockAction) => void;
  showReplyAll?: boolean;
  isLatest: boolean;
}) {
  const [showFull, setShowFull] = useState(false);
  const expanded = isLatest || showFull;
  // Body rendering moved out of this component on 2026-05-07: rich
  // marketing/newsletter emails (Quo dark-themed templates) need their
  // own <style> sheet + page bgcolor to survive, but inline rendering
  // forced Ace's app CSS over the email's. EmailHtmlViewer drops the
  // body into a sandboxed iframe so the email's design renders intact
  // (and broken-image hiding moves with it into the iframe).

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setShowFull(true)}
        className={
          "flex w-full items-baseline gap-3 px-4 py-2 text-left transition hover:bg-court-surface-subtle/60 " +
          (isFirst ? "" : "border-t border-court-border")
        }
        aria-label="Expand message"
      >
        <span className="shrink-0 truncate text-sm font-medium text-court-fg">
          {msg.fromName || msg.fromEmail || "(unknown sender)"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-court-fg-muted">
          {snippetFromBody(msg.bodyHtml)}
        </span>
        <span className="shrink-0 text-[11px] text-court-fg-muted">
          {shortTimestamp(msg.dateIso)}
        </span>
      </button>
    );
  }

  return (
    <article
      className={
        "min-w-0 overflow-hidden px-4 py-2 " +
        (isFirst ? "" : "border-t border-court-border")
      }
    >
      {/* Single tight header row: sender + date + per-message actions
          all on one line, "to ..." line underneath in muted small.
          Pre-fix this took two rows of large text + a separate Open
          client chip, eating most of the popup's vertical real estate
          when the actual email body was three letters long. */}
      <header className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-medium text-court-fg">
            {msg.fromName || msg.fromEmail || "(unknown sender)"}
          </span>
          {msg.senderClient && (
            // Sender's address resolved to a Contact whose Client we
            // know — surface a one-click jump to that profile so the
            // recruiter can land on the company without leaving the
            // thread first. Subtler treatment now (link, not button)
            // so it reads as metadata next to the name instead of a
            // chip taking its own row.
            <Link
              href={`/clients/${msg.senderClient.slug}`}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-court-accent-dark hover:underline"
              title={`Open ${msg.senderClient.name}`}
            >
              <Building2 className="h-3 w-3" />
              {msg.senderClient.name}
            </Link>
          )}
          {msg.to && (
            <span className="truncate text-[11px] text-court-fg-muted">
              to {msg.to}
              {msg.cc ? ` · cc ${msg.cc}` : ""}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onAction && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onAction("reply")}
                aria-label="Reply to this message"
                title="Reply to this message"
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
              >
                <Reply className="h-3 w-3" /> Reply
              </button>
              {showReplyAll && (
                <button
                  type="button"
                  onClick={() => onAction("replyAll")}
                  aria-label="Reply all to this message"
                  title="Reply all to this message"
                  className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
                >
                  <ReplyAll className="h-3 w-3" /> Reply All
                </button>
              )}
              <button
                type="button"
                onClick={() => onAction("forward")}
                aria-label="Forward this message"
                title="Forward this message"
                className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-1.5 py-0.5 text-[10px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
              >
                <Forward className="h-3 w-3" /> Forward
              </button>
            </div>
          )}
          <span className="text-[11px] text-court-fg-muted">
            {msg.dateIso ? new Date(msg.dateIso).toLocaleString() : ""}
          </span>
        </div>
      </header>
      {/* Iframe-isolated email body. The previous inline render layered
          Ace's typography rules over the email's own design which
          collapsed dark-themed marketing emails into a flattened
          single-column light layout. The viewer drops the bodyHtml into
          a sandboxed iframe so newsletter <style> blocks render against
          their own document, while Ace's chrome sits cleanly around it. */}
      <div className="min-w-0 overflow-x-auto">
        <EmailHtmlViewer html={msg.bodyHtml} />
      </div>
    </article>
  );
}
