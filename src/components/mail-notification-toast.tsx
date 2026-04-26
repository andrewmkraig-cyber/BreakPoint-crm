"use client";

import { Reply, X } from "lucide-react";
import { toast } from "sonner";
import { useComposerManager } from "@/lib/composer-manager";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import type { UnreadInboxThread } from "@/lib/mail-context";

// In-app new-mail toast. Rendered via sonner's custom slot so it can
// host the Reply / dismiss buttons inline. Reply boots the global
// ComposerManager pre-loaded with thread context; dismiss closes the
// toast without touching Gmail (the thread stays unread).
//
// Auto-dismiss timing + maximum-visible cap are configured at the
// Toaster level (Providers).

type ComposeInitPayload = {
  templates: ActiveTemplateSummary[];
  user: { firstName: string; fullName: string };
};

let cachedInit: Promise<ComposeInitPayload> | null = null;
function fetchComposeInit(): Promise<ComposeInitPayload> {
  if (cachedInit) return cachedInit;
  cachedInit = (async () => {
    const res = await fetch("/api/mail/compose-init");
    if (!res.ok) {
      cachedInit = null;
      throw new Error(`compose-init failed (${res.status})`);
    }
    return (await res.json()) as ComposeInitPayload;
  })();
  return cachedInit;
}

export function renderNewMailToast(thread: UnreadInboxThread) {
  toast.custom(
    (id) => <NewMailToast thread={thread} toastId={id} />,
    { duration: 8_000 },
  );
}

function NewMailToast({
  thread,
  toastId,
}: {
  thread: UnreadInboxThread;
  toastId: string | number;
}) {
  const composer = useComposerManager();

  async function onReply() {
    try {
      const init = await fetchComposeInit();
      const subject = thread.subject.toLowerCase().startsWith("re:")
        ? thread.subject
        : `Re: ${thread.subject}`;
      const to = thread.fromName
        ? `${thread.fromName} <${thread.fromEmail}>`
        : thread.fromEmail;
      composer.open({
        defaultTo: to,
        defaultSubject: subject,
        threadId: thread.id,
        templates: init.templates,
        mergeContext: {
          user: { firstName: init.user.firstName, fullName: init.user.fullName },
        },
        modalTitle: "Reply",
      });
      toast.dismiss(toastId);
    } catch (err) {
      toast.error("Couldn't open composer", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return (
    <div className="flex w-[360px] gap-3 rounded-lg border border-court-border bg-court-surface p-3 shadow-lg">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-court-fg">
          {thread.fromName || thread.fromEmail || "(unknown sender)"}
        </div>
        <div className="mt-0.5 truncate text-xs text-court-fg-muted">
          {thread.subject || "(no subject)"}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <button
          type="button"
          onClick={onReply}
          aria-label="Reply"
          className="inline-flex items-center gap-1 rounded-md border border-court-border bg-court-surface px-2 py-1 text-[11px] font-medium text-court-fg-muted shadow-sm transition hover:text-court-fg"
        >
          <Reply className="h-3 w-3" />
          Reply
        </button>
        <button
          type="button"
          onClick={() => toast.dismiss(toastId)}
          aria-label="Dismiss"
          className="inline-flex items-center rounded-md border border-court-border bg-court-surface p-1 text-court-fg-muted shadow-sm transition hover:text-court-fg"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
