"use client";

import { Mail as MailIcon, Reply, X } from "lucide-react";
import { toast } from "sonner";
import { useComposerManager } from "@/lib/composer-manager";
import {
  getStoredToastTheme,
  toastBoxShadow,
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

// Stable per-thread toast id so the Mail Tab can dismiss the
// notification when the user opens that thread. sonner accepts a
// custom id; calls to toast.dismiss(id) for an inactive id are a
// safe no-op, so loadThread can fire this unconditionally.
export const mailToastIdForThread = (threadId: string) => `mail-toast-${threadId}`;

export function renderNewMailToast(thread: UnreadInboxThread) {
  toast.custom(
    (id) => <NewMailToast thread={thread} toastId={id} />,
    { id: mailToastIdForThread(thread.id), duration: 8_000 },
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
      className="relative flex min-w-[280px] items-center gap-3 overflow-hidden rounded-[14px]"
      style={{
        background: theme.bg,
        color: theme.text,
        border: `1px solid ${theme.border}`,
        boxShadow: toastBoxShadow(),
        padding: "12px 14px",
      }}
    >
      {theme.leftStrip && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: theme.accent }}
        />
      )}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: theme.iconBg, color: theme.iconFg }}
      >
        <MailIcon className="h-[17px] w-[17px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span
            className="truncate text-[13.5px] font-semibold"
            style={{ color: theme.text }}
          >
            {thread.fromName || thread.fromEmail || "(unknown sender)"}
          </span>
          <span
            className="shrink-0 text-[11px]"
            style={{ color: theme.subText }}
          >
            · Email
          </span>
        </div>
        <div
          className="mt-0.5 truncate text-[12.5px]"
          style={{ color: theme.subText }}
        >
          {truncate(thread.subject || "(no subject)", 60)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ChipButton theme={theme} onClick={onReply} ariaLabel="Reply">
          <Reply className="h-3 w-3" />
          <span>Reply</span>
        </ChipButton>
        <ChipButton
          theme={theme}
          onClick={() => toast.dismiss(toastId)}
          ariaLabel="Dismiss"
          iconOnly
        >
          <X className="h-3 w-3" />
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
        "inline-flex items-center justify-center gap-1 rounded-[8px] text-[12px] font-semibold transition " +
        (iconOnly ? "h-7 w-7 p-0" : "h-7 px-2.5")
      }
      style={{
        background: theme.buttonBg,
        color: theme.buttonText,
        border: `1px solid ${theme.buttonBorder}`,
      }}
    >
      {children}
    </button>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
