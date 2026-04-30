"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Building2, Forward, Reply, ReplyAll } from "lucide-react";
import type { MailThreadMessage } from "@/lib/gmail";

export type MessageBlockAction = "reply" | "replyAll" | "forward";

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
export function MessageBlock({
  msg,
  isFirst,
  onAction,
  showReplyAll = true,
}: {
  msg: MailThreadMessage;
  isFirst: boolean;
  // When provided, each MessageBlock renders its own Reply / Reply
  // All / Forward buttons. The parent ThreadDetail wires the handler
  // so the composer opens with THIS message's recipients + quoted
  // body — lets the recruiter reply to any message in a long thread,
  // not just the latest one. Omit (or pass undefined) to hide the
  // per-message buttons (e.g. while the composer is already open).
  onAction?: (mode: MessageBlockAction) => void;
  // When false, the Reply All button is hidden — the parent computes
  // this from the message's recipient set (true when the message has
  // any addresses besides the current user; false when it's a DM).
  // Defaults to true so callers that don't compute this still get the
  // legacy three-button layout.
  showReplyAll?: boolean;
}) {
  // After the dangerouslySetInnerHTML body mounts, attach error
  // handlers to every <img> inside it so a failed remote load
  // collapses the element rather than leaving a broken-image
  // placeholder that reserves the image's original `width` /
  // `height` space. Without this, Quo support emails (and other
  // templates with a CDN-hosted header banner blocked by the
  // recipient network) painted a giant empty rectangle above the
  // body — the avatar reserved its full height even though the
  // src never loaded.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll("img"));
    function hideBroken(this: HTMLImageElement) {
      this.style.display = "none";
    }
    for (const img of imgs) {
      // complete + naturalWidth=0 means the image already failed
      // (cached error) before our listener attached. Hide
      // synchronously in that case.
      if (img.complete && img.naturalWidth === 0) {
        img.style.display = "none";
      } else {
        img.addEventListener("error", hideBroken);
      }
    }
    return () => {
      for (const img of imgs) img.removeEventListener("error", hideBroken);
    };
  }, [msg.bodyHtml]);

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
      <div
        ref={bodyRef}
        className={[
          // Match Gmail's body typography exactly: no whitespace-pre-line
          // (Gmail uses normal HTML whitespace handling — literal source
          // newlines between tags collapse to spaces; visible breaks
          // come from <br> / <div><br></div> structure only). The
          // earlier pre-line treatment was layered ON TOP of those
          // structural breaks and produced the 6-line gap-between-
          // paragraphs problem reported on 2026-04-30. Plain-text
          // emails still wrap correctly because gmail.ts puts them
          // inside a <pre class=whitespace-pre-wrap> wrapper that the
          // [&_pre] rule below preserves.
          "max-w-none text-sm leading-normal",
          // Cap the rendered email to its container so wide signature
          // tables / fixed-width templates can't blow the floating
          // window apart at narrow sizes. min-w-0 lets the flex
          // container actually constrain us; overflow-x-auto gives
          // the user a horizontal scroll within the message instead
          // of pushing the popup wider than the viewport.
          "min-w-0 max-w-full overflow-x-auto",
          // Background guarantees a light surface for the email body
          // even in dark Court Modes — most HTML emails ship with
          // dark text and would be unreadable on the dark popup bg
          // otherwise. We dropped the previous border + shadow + p-4
          // chrome that wrapped the body in an extra "reading paper"
          // card; with one short message the card looked like a tiny
          // bubble inside a giant empty popup. The body now flows
          // edge-to-edge so the email itself dominates the popup
          // visually. Anchor + blockquote colors below stay pinned to
          // fixed slate/green values so they read on either bg.
          "bg-white py-1 text-slate-900 dark:bg-[#F5F1E8] dark:rounded-md dark:px-3 dark:py-2",
          // No [&>div+div]:mt-2 here — Gmail emits empty <div><br></div>
          // spacers between paragraphs already, so adding extra margin
          // on top doubled the rhythm and was the second contributor
          // to the over-spacing bug.
          // Block-level rhythm for proper <p> based emails. Tightened
          // to match Gmail's own paragraph cadence.
          "[&_p]:my-1 [&_p]:leading-normal",
          "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:font-serif [&_h1]:text-lg [&_h1]:font-semibold",
          "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-serif [&_h2]:text-base [&_h2]:font-semibold",
          "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:font-semibold",
          // Inline emphasis.
          "[&_strong]:font-semibold [&_b]:font-semibold",
          "[&_em]:italic [&_i]:italic",
          // Lists — sanitize-html keeps the markup; we provide bullets.
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_li]:my-0.5",
          // Links pop in the brand green, hardcoded so they read on
          // the forced-white card in every Court Mode (the
          // court-accent-dark token shifts to a lifted lighter green
          // on dark themes and would disappear against white).
          "[&_a]:text-[#3F7030] [&_a]:underline [&_a:hover]:opacity-80",
          // Quoted blocks (forwards / inline replies) get a left rule.
          // Slate fixed-on-white tones — court-fg-muted would invert
          // to a near-white on dark themes and vanish against the
          // forced-white background.
          "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-500",
          // <pre> is the wrapper for plain-text emails (gmail.ts
          // wraps text/plain bodies in `<pre class=whitespace-pre-wrap
          // font-sans>`); keep the wrap behavior + match the body
          // typography so plain emails read like the rest of the
          // thread instead of monospace blocks.
          "[&_pre]:whitespace-pre-wrap [&_pre]:font-sans [&_pre]:text-sm [&_pre]:leading-normal",
          // Inline images: cap width so wide screenshots don't blow
          // out the column. Don't impose `h-auto` — the source
          // height attribute (and the sender's signature template
          // sizing) needs to stay authoritative, otherwise the logo
          // grows to its natural size and wrecks the rowspan/cell
          // alignment in multi-cell signatures. align-middle keeps
          // inline icons (envelope/phone/web circles) riding the
          // baseline instead of dropping below it.
          "[&_img]:max-w-full [&_img]:align-middle",
          // Tables (Gmail signatures, forwarded confirmations).
          // Previously every <td> got `py-1 pr-3` which fought the
          // sender's own cellpadding/style and produced the cracked
          // signature layout (logo split off from contact rows, Quo
          // avatar pushed away from its message body). Let the
          // sender's own table styling drive spacing. We only set
          // border-collapse + a vertical-align default so multi-row
          // tables track the original geometry.
          "[&_table]:border-collapse [&_td]:align-top [&_th]:align-top",
          // Inside table cells (signatures), kill the body's
          // default 8px paragraph/div top+bottom margin. Andrew's
          // BreakPoint signature stacks each contact line as its
          // own <p> inside a cell — that 8+8 collapsed margin per
          // row was what pushed his email/phone/web rows so far
          // apart. Same fix for the empty-block-as-spacer divs
          // some templates use. Tighter line-height on the table
          // itself rounds out the compact vertical rhythm Gmail
          // shows natively for signatures.
          "[&_table]:leading-snug [&_table_p]:!my-0 [&_table_div]:!my-0",
        ].join(" ")}
        dangerouslySetInnerHTML={{ __html: msg.bodyHtml }}
      />
    </article>
  );
}
