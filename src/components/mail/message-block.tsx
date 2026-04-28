import type { MailThreadMessage } from "@/lib/gmail";

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
}: {
  msg: MailThreadMessage;
  isFirst: boolean;
}) {
  return (
    <article
      className={
        "px-5 py-4 " + (isFirst ? "" : "border-t border-court-border")
      }
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-court-fg">
            {msg.fromName || msg.fromEmail || "(unknown sender)"}
          </div>
          {msg.to && (
            <div className="text-[11px] text-court-fg-muted">
              to {msg.to}
              {msg.cc ? ` · cc ${msg.cc}` : ""}
            </div>
          )}
        </div>
        <div className="text-[11px] text-court-fg-muted">
          {msg.dateIso ? new Date(msg.dateIso).toLocaleString() : ""}
        </div>
      </header>
      <div
        className={[
          "max-w-none text-sm leading-relaxed text-court-fg",
          // Block-level rhythm.
          "[&_p]:my-2 [&_p]:leading-relaxed",
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
          // Links pop in the brand color, not the bare browser blue.
          "[&_a]:text-court-accent-dark [&_a]:underline [&_a:hover]:opacity-80",
          // Quoted blocks (forwards / inline replies) get a left rule.
          "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-court-border [&_blockquote]:pl-3 [&_blockquote]:text-court-fg-muted",
          // <pre> is the wrapper for plain-text emails (gmail.ts
          // wraps text/plain bodies in `<pre class=whitespace-pre-wrap
          // font-sans>`); keep the wrap behavior + match the body
          // typography so plain emails read like the rest of the
          // thread instead of monospace blocks.
          "[&_pre]:whitespace-pre-wrap [&_pre]:font-sans [&_pre]:text-sm [&_pre]:leading-relaxed",
          // Inline images shouldn't blow out the column width.
          "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
          // Tables (Gmail signatures, forwarded confirmations) get
          // sane defaults so the layout doesn't collapse to one line.
          "[&_table]:my-2 [&_table]:w-auto [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_th]:font-semibold",
        ].join(" ")}
        dangerouslySetInnerHTML={{ __html: msg.bodyHtml }}
      />
    </article>
  );
}
