"use client";

import { Mail as MailIcon, Reply, X } from "lucide-react";
import { toast } from "sonner";
import { useComposerManager } from "@/lib/composer-manager";
import {
  getStoredToastTheme,
  toastGlowBoxShadow,
  type ToastThemeSpec,
} from "@/lib/toast-theme";
import type { ActiveTemplateSummary } from "@/app/email/actions";
import type { UnreadInboxThread } from "@/lib/mail-context";

// In-app new-mail toast. Layout (per the design mockup):
//   ┌─────────────────────────────────────────────────────────┐
//   │ ◯  Sender Name (bold)            [↩ Reply] [✕]          │
//   │    SUBJECT LINE (uppercase)                             │
//   └─────────────────────────────────────────────────────────┘
// 2px themed border, soft glow box-shadow in the theme glow color
// (Dark opts out), 40px circular envelope-icon container on the
// left, sender + uppercase subject in the middle, Reply + X chips
// on the right.
//
// Theme is read from localStorage at render-time so the picker in
// Settings takes effect on the very next toast — no reload, no
// remount. Auto-dismiss + max-visible cap come from the Toaster
// (Providers).

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
      className="flex min-w-[320px] items-center gap-3 rounded-2xl"
      style={{
        background: theme.bg,
        color: theme.text,
        border: `2px solid ${theme.border}`,
        boxShadow: toastGlowBoxShadow(theme),
        padding: "16px 20px",
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ border: `2px solid ${theme.iconCircleBorder}` }}
      >
        <MailIcon className="h-4 w-4" style={{ color: theme.text }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-bold" style={{ color: theme.text }}>
          {thread.fromName || thread.fromEmail || "(unknown sender)"}
        </div>
        <div
          className="mt-0.5 truncate text-sm uppercase tracking-wide"
          style={{ color: theme.subText }}
        >
          {thread.subject || "(no subject)"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ChipButton theme={theme} onClick={onReply} ariaLabel="Reply">
          <Reply className="h-4 w-4" />
          <span>Reply</span>
        </ChipButton>
        <ChipButton
          theme={theme}
          onClick={() => toast.dismiss(toastId)}
          ariaLabel="Dismiss"
          iconOnly
        >
          <X className="h-4 w-4" />
        </ChipButton>
      </div>
    </div>
  );
}

function ChipButton({
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
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition " +
        (iconOnly ? "w-9" : "px-3")
      }
      style={{
        background: theme.buttonBg,
        color: theme.text,
        border: `1px solid ${theme.buttonBorder}`,
      }}
    >
      {children}
    </button>
  );
}
