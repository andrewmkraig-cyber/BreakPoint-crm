"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  Clock,
  Download,
  File as FileIcon,
  FileText,
  Forward,
  MapPin,
  Paperclip,
  Reply,
  ReplyAll,
  User as UserIcon,
  X,
} from "lucide-react";
import type {
  MailAttachmentRef,
  MailCalendarInvite,
  MailThreadMessage,
} from "@/lib/gmail";
import { EmailHtmlViewer } from "@/components/mail/email-html-viewer";
import { Button } from "@/components/ui/button";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Truncate to ~30 chars while preserving the extension so the eye still
// sees ".pdf" / ".docx" — "Installation Repair Service Agreement…pdf"
// rather than "Installation Repair Service Agreem…" with no hint of
// type.
function truncateFilename(name: string, max = 30): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= 8) {
    const ext = name.slice(dot);
    const keep = Math.max(1, max - ext.length - 1);
    return `${name.slice(0, keep)}…${ext}`;
  }
  return `${name.slice(0, max - 1)}…`;
}

// Pick lucide icon + Court-aware tint per file family. PDF reads red,
// Word reads blue, everything else falls back to a muted generic File
// icon so the pill doesn't lie about an unknown mime.
function pickAttachmentIcon(mimeType: string): {
  Icon: typeof FileText;
  className: string;
} {
  if (mimeType === "application/pdf") {
    return { Icon: FileText, className: "text-red-600 dark:text-red-400" };
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    return { Icon: FileText, className: "text-blue-600 dark:text-blue-400" };
  }
  return { Icon: FileIcon, className: "text-court-fg-muted" };
}

function AttachmentPill({
  messageId,
  att,
}: {
  messageId: string;
  att: MailAttachmentRef;
}) {
  const { Icon, className } = pickAttachmentIcon(att.mimeType);
  const href = `/api/mail/attachments/${encodeURIComponent(
    messageId,
  )}/${encodeURIComponent(att.attachmentId)}?filename=${encodeURIComponent(
    att.filename,
  )}&mimeType=${encodeURIComponent(att.mimeType)}`;
  const size = formatBytes(att.size);
  return (
    <a
      href={href}
      download={att.filename}
      title={att.filename}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-court-border bg-court-surface px-2.5 py-1.5 text-xs text-court-fg shadow-sm transition hover:border-brand/40 hover:text-brand-dark"
    >
      <Icon className={`h-4 w-4 shrink-0 ${className}`} />
      <span className="min-w-0 truncate font-medium">
        {truncateFilename(att.filename)}
      </span>
      {size && (
        <span className="shrink-0 text-[11px] text-court-fg-muted">
          {size}
        </span>
      )}
      <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded border border-court-border bg-court-surface-subtle px-1.5 py-0.5 text-[11px] font-medium text-court-fg-muted">
        <Download className="h-3 w-3" />
        Download
      </span>
    </a>
  );
}

export type MessageBlockAction = "reply" | "replyAll" | "forward";

type InviteResponse = "accepted" | "declined" | "tentative";

const RESPONSE_LABEL: Record<InviteResponse, string> = {
  accepted: "Yes, going",
  declined: "No, not going",
  tentative: "Maybe",
};

// Native RSVP card for calendar invites, rendered above the email body
// when a message carries a parsed text/calendar part. Mirrors Gmail's
// Yes / No / Maybe affordance: the buttons POST to /api/mail/calendar-rsvp,
// which flips the user's attendee status on the auto-added Google Calendar
// event and notifies the organizer. A CANCEL-method invite renders a
// read-only "cancelled" note instead of buttons.
function CalendarInviteCard({
  invite,
}: {
  invite: MailCalendarInvite;
}) {
  const [chosen, setChosen] = useState<InviteResponse | null>(null);
  const [busy, setBusy] = useState<InviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelled = invite.method === "CANCEL";

  async function respond(response: InviteResponse) {
    if (busy) return;
    setBusy(response);
    setError(null);
    try {
      const res = await fetch("/api/mail/calendar-rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iCalUID: invite.uid, response }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not send your response. Please try again.");
        return;
      }
      setChosen(response);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-court-border bg-court-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-court-fg">
            {invite.summary}
          </p>
          {invite.startDisplay && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-court-fg-muted">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {invite.startDisplay}
                {invite.endDisplay ? ` - ${invite.endDisplay}` : ""}
              </span>
            </p>
          )}
          {invite.organizer && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-court-fg-muted">
              <UserIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{invite.organizer}</span>
            </p>
          )}
          {invite.location && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-court-fg-muted">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{invite.location}</span>
            </p>
          )}
        </div>
      </div>

      {cancelled ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-300">
          <X className="h-4 w-4 shrink-0" /> This event was cancelled by the
          organizer.
        </p>
      ) : chosen ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-court-brand-dark">
          <Check className="h-4 w-4 shrink-0" /> You responded:{" "}
          {RESPONSE_LABEL[chosen]}. The organizer has been notified.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-court-fg-muted">Going?</span>
            <Button
              variant="primary"
              size="sm"
              disabled={busy !== null}
              onClick={() => respond("accepted")}
            >
              {busy === "accepted" ? "Saving…" : "Yes"}
            </Button>
            <Button
              variant="reject"
              size="sm"
              disabled={busy !== null}
              onClick={() => respond("declined")}
            >
              {busy === "declined" ? "Saving…" : "No"}
            </Button>
            <Button
              variant="schedule"
              size="sm"
              disabled={busy !== null}
              onClick={() => respond("tentative")}
            >
              {busy === "tentative" ? "Saving…" : "Maybe"}
            </Button>
          </div>
          {error && (
            <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Initials avatar for the message header card. Pulls from fromName when
// present (first letter of first + last token), otherwise the first
// letter of the local part of the email. Falls back to "?" when neither
// is usable so the card layout doesn't shift on weirdly-formed senders.
// Tinted with Court brand tokens so the badge skins correctly across
// every Court Mode palette — no hardcoded hexes per CLAUDE.md rule 12.
function SenderAvatar({
  name,
  email,
}: {
  name: string | null;
  email: string | null;
}) {
  const initials = (() => {
    const trimmedName = (name ?? "").trim();
    if (trimmedName) {
      const parts = trimmedName.split(/\s+/).filter(Boolean);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    const trimmedEmail = (email ?? "").trim();
    if (trimmedEmail) {
      const local = trimmedEmail.split("@")[0] || trimmedEmail;
      const parts = local.split(/[.\-_+]/).filter(Boolean);
      if (parts.length === 0) return local.slice(0, 2).toUpperCase();
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return "?";
  })();
  return (
    <div
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-court-brand-tint text-xs font-semibold text-court-brand-dark"
    >
      {initials}
    </div>
  );
}

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
//   On mount: the latest message renders expanded, all older messages
//   render as a one-line summary row.
//   After mount: clicking either state toggles it — collapsed rows
//   expand; expanded headers collapse back to the one-line summary.
export function MessageBlock({
  msg,
  isFirst,
  onAction,
  showReplyAll = true,
  isLatest,
  headerActions,
}: {
  msg: MailThreadMessage;
  isFirst: boolean;
  onAction?: (mode: MessageBlockAction) => void;
  showReplyAll?: boolean;
  isLatest: boolean;
  // Thread-level toolbar (Reply / Reply All / Forward / 3-dot) rendered
  // in the top-right of the header card when provided. ThreadDetail
  // passes this to the latest message only — older messages keep the
  // per-message onAction buttons in the same slot. When both are
  // supplied, headerActions wins (the latest message gets the thread
  // toolbar; per-message buttons would be duplicate chrome).
  headerActions?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(isLatest);
  // Tap/click-to-copy for the sender address. stopPropagation so the
  // click copies instead of collapsing the message card. Brief "Copied"
  // confirmation auto-clears after 1.5s.
  const [copiedEmail, setCopiedEmail] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function copyFromEmail(e: ReactMouseEvent) {
    e.stopPropagation();
    const addr = msg.fromEmail;
    if (!addr || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(addr).then(() => {
      setCopiedEmail(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedEmail(false), 1500);
    });
  }
  // Body rendering moved out of this component on 2026-05-07: rich
  // marketing/newsletter emails (Quo dark-themed templates) need their
  // own <style> sheet + page bgcolor to survive, but inline rendering
  // forced Ace's app CSS over the email's. EmailHtmlViewer drops the
  // body into a sandboxed iframe so the email's design renders intact
  // (and broken-image hiding moves with it into the iframe).

  if (!expanded) {
    const attachments = msg.attachments ?? [];
    const firstAttachment = attachments[0];
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={
          "flex w-full items-baseline gap-3 px-4 py-2 text-left transition hover:bg-court-surface-subtle/60 " +
          (isFirst ? "" : "border-t border-court-border")
        }
        aria-label={
          firstAttachment
            ? `Expand message with attachment ${firstAttachment.filename}`
            : "Expand message"
        }
      >
        <span className="shrink-0 truncate text-sm font-medium text-court-fg">
          {msg.fromName || msg.fromEmail || "(unknown sender)"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-court-fg-muted">
          {snippetFromBody(msg.bodyHtml)}
        </span>
        {firstAttachment && (
          <span
            title={attachments.map((att) => att.filename).join(", ")}
            className="inline-flex max-w-48 shrink-0 items-center gap-1 rounded-md border border-court-brand/30 bg-court-brand-tint px-2 py-0.5 text-[11px] font-medium text-court-brand-dark"
          >
            <Paperclip className="h-3 w-3 shrink-0" />
            <span className="truncate">{truncateFilename(firstAttachment.filename, 24)}</span>
            {attachments.length > 1 && (
              <span className="shrink-0">+{attachments.length - 1}</span>
            )}
          </span>
        )}
        <span className="shrink-0 text-[11px] text-court-fg-muted">
          {shortTimestamp(msg.dateIso)}
        </span>
      </button>
    );
  }

  return (
    <article
      className={
        "min-w-0 overflow-hidden px-4 py-3 " +
        (isFirst ? "" : "border-t border-court-border")
      }
    >
      {/* Message header card: avatar + name/email stack on the left,
          per-message actions + timestamp on the right, a thin divider,
          then a To/Cc metadata row beneath. Wraps in a rounded card with
          a subtle border + shadow so it visually sits above the email
          body. Sender email is always visible (no hover/expand) per
          Andrew's reading-pane redesign 2026-05-27. */}
      <div
        onClick={() => setExpanded(false)}
        title="Click to collapse"
        className="mb-3 cursor-pointer rounded-lg border border-court-border bg-court-surface shadow-sm"
      >
        <header className="flex items-start gap-3 px-4 py-3">
          <SenderAvatar name={msg.fromName} email={msg.fromEmail} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {/* Full name on mobile (wraps), truncated on desktop (lg+)
                  so the desktop reading pane is byte-identical to before. */}
              <span className="break-words text-sm font-semibold text-court-fg lg:truncate">
                {msg.fromName || msg.fromEmail || "(unknown sender)"}
              </span>
              {msg.senderClient && (
                // Sender's address resolved to a Contact whose Client
                // we know — surface a one-click jump to that profile so
                // the recruiter can land on the company without leaving
                // the thread first. stopPropagation so the click
                // navigates instead of collapsing the message body.
                <Link
                  href={`/clients/${msg.senderClient.slug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-court-accent-dark hover:underline"
                  title={`Open ${msg.senderClient.name}`}
                >
                  <Building2 className="h-3 w-3" />
                  {msg.senderClient.name}
                </Link>
              )}
            </div>
            {msg.fromEmail && (
              <>
                {/* Desktop (lg+): visually same truncated address, now
                    clickable to copy. */}
                <button
                  type="button"
                  onClick={copyFromEmail}
                  title="Click to copy email address"
                  aria-label={`Copy email address ${msg.fromEmail}`}
                  className="mt-0.5 hidden max-w-full truncate text-left text-xs text-court-fg-muted transition hover:text-court-fg lg:block"
                >
                  {copiedEmail ? (
                    <span className="inline-flex items-center gap-1 font-medium text-court-brand-dark">
                      <Check className="h-3 w-3 shrink-0" /> Copied
                    </span>
                  ) : (
                    msg.fromEmail
                  )}
                </button>
                {/* Mobile (<lg): full address. break-all so a long address
                    wraps instead of overflowing. */}
                <button
                  type="button"
                  onClick={copyFromEmail}
                  title="Tap to copy email address"
                  aria-label={`Copy email address ${msg.fromEmail}`}
                  className="mt-0.5 flex items-start gap-1 break-all text-left text-xs text-court-fg-muted transition active:text-court-fg lg:hidden"
                >
                  {copiedEmail ? (
                    <span className="inline-flex items-center gap-1 font-medium text-court-brand-dark">
                      <Check className="h-3 w-3 shrink-0" /> Copied
                    </span>
                  ) : (
                    <span className="break-all">{msg.fromEmail}</span>
                  )}
                </button>
              </>
            )}
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center gap-1"
          >
            {/* Latest message → thread-level toolbar from ThreadDetail.
                Older messages → per-message Reply / Reply All / Forward
                buttons. Same slot, mutually exclusive — never duplicate
                chrome. Timestamp moved out of this row (now lives at
                the right edge of the To/Cc metadata row below) so the
                action buttons get a clean horizontal lane. */}
            {headerActions
              ? headerActions
              : onAction && (
                  <>
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
                  </>
                )}
          </div>
        </header>
        {(msg.to || msg.cc || msg.dateIso) && (
          // Metadata row: To · Cc on the left, timestamp pinned to the
          // right of the same line. justify-between handles the split;
          // the inner left group wraps if To/Cc are long, and the
          // timestamp stays a single-line whitespace-nowrap anchor on
          // the right.
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-court-border px-4 py-2 text-[11px] text-court-fg-muted"
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              {msg.to && (
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-court-fg">To</span>{" "}
                  {msg.to}
                </span>
              )}
              {msg.cc && (
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-court-fg">Cc</span>{" "}
                  {msg.cc}
                </span>
              )}
            </div>
            {msg.dateIso && (
              <span className="whitespace-nowrap">
                {new Date(msg.dateIso).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Calendar invite RSVP card. Renders above the body when the
          message carries a parsed text/calendar part so the recruiter can
          answer Yes / No / Maybe without leaving Ace - the part Gmail shows
          as its invite card but Ace previously dropped entirely. */}
      {msg.calendarInvite && (
        <CalendarInviteCard invite={msg.calendarInvite} />
      )}
      {/* Iframe-isolated email body. The previous inline render layered
          Ace's typography rules over the email's own design which
          collapsed dark-themed marketing emails into a flattened
          single-column light layout. The viewer drops the bodyHtml into
          a sandboxed iframe so newsletter <style> blocks render against
          their own document, while Ace's chrome sits cleanly around it. */}
      <div className="min-w-0 overflow-x-auto pb-1">
        <EmailHtmlViewer html={msg.bodyHtml} />
      </div>
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {msg.attachments.map((att) => (
            <AttachmentPill
              key={att.attachmentId}
              messageId={msg.id}
              att={att}
            />
          ))}
        </div>
      )}
    </article>
  );
}
