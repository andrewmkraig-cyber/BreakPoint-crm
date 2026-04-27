import type { MailThreadMessage } from "@/lib/gmail";

// Single message renderer used by both the inline Mail Tab thread
// pane and the popped-out FloatingThreadWindow. Body HTML is already
// sanitized by the /api/mail/threads/[id] route — safe to render via
// dangerouslySetInnerHTML here.
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
        className="prose prose-sm max-w-none text-court-fg prose-a:text-brand-dark"
        dangerouslySetInnerHTML={{ __html: msg.bodyHtml }}
      />
    </article>
  );
}
