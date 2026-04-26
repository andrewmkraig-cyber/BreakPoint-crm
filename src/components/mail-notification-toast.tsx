"use client";

import { Reply, X } from "lucide-react";
import { toast } from "sonner";
import { useComposerManager } from "@/lib/composer-manager";
import { getStoredToastTheme, type ToastThemeSpec } from "@/lib/toast-theme";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import type { UnreadInboxThread } from "@/lib/mail-context";

// In-app new-mail toast. Rendered via sonner's custom slot so it can
// host the Reply / dismiss buttons inline. Reply boots the global
// ComposerManager pre-loaded with thread context; dismiss closes the
// toast without touching Gmail (the thread stays unread).
//
// Theme is read from localStorage at render-time (not at module load)
// so the picker in Settings takes effect on the very next toast.
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
  const theme = getStoredToastTheme();

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
    <div
      className="flex min-w-[320px] gap-3 rounded-lg p-4 shadow-lg"
      style={{
        background: theme.bg,
        color: theme.text,
        border: theme.border ?? "1px solid transparent",
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold" style={{ color: theme.text }}>
          {thread.fromName || thread.fromEmail || "(unknown sender)"}
        </div>
        <div
          className="mt-0.5 truncate text-sm"
          style={{ color: theme.subText ?? theme.text }}
        >
          {thread.subject || "(no subject)"}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <ActionButton theme={theme} onClick={onReply} ariaLabel="Reply">
          <Reply className="h-3 w-3" />
          <span>Reply</span>
        </ActionButton>
        <ActionButton
          theme={theme}
          onClick={() => toast.dismiss(toastId)}
          ariaLabel="Dismiss"
          iconOnly
        >
          <X className="h-3 w-3" />
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  theme,
  onClick,
  ariaLabel,
  iconOnly,
  children,
}: {
  theme: ToastThemeSpec;
  onClick: () => void;
  ariaLabel: string;
  iconOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={
        "inline-flex items-center gap-1 rounded-md text-[11px] font-medium shadow-sm transition " +
        (iconOnly ? "p-1" : "px-2 py-1")
      }
      style={{
        background: theme.actionBg,
        color: theme.actionText,
        border: `1px solid ${theme.actionBorder}`,
      }}
    >
      {children}
    </button>
  );
}
