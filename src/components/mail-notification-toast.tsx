"use client";

import { useEffect } from "react";
import { Mail as MailIcon, Reply, Eye, CheckCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useFloatingThread } from "@/lib/floating-thread-context";
import { useMailContext } from "@/lib/mail-context";
import { getStoredToastDurationMs, registerToast } from "@/lib/toast-prefs";
import { getStoredToastTheme } from "@/lib/toast-theme";
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
  user: { firstName: string; fullName: string; email: string };
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

type LabelRow = { id: string; name: string; type?: string };
let cachedLabels: Promise<LabelRow[]> | null = null;
function fetchLabels(): Promise<LabelRow[]> {
  if (cachedLabels) return cachedLabels;
  cachedLabels = (async () => {
    const res = await fetch("/api/mail/labels");
    if (!res.ok) {
      cachedLabels = null;
      throw new Error(`labels failed (${res.status})`);
    }
    const body = (await res.json()) as { labels?: LabelRow[] };
    return body.labels ?? [];
  })();
  return cachedLabels;
}

// Stable per-thread toast id so the Mail Tab can dismiss the
// notification when the user opens that thread. sonner accepts a
// custom id; calls to toast.dismiss(id) for an inactive id are a
// safe no-op, so loadThread can fire this unconditionally.
export const mailToastIdForThread = (threadId: string) => `mail-toast-${threadId}`;

export function renderNewMailToast(thread: UnreadInboxThread) {
  toast.custom(
    (id) => <NewMailToast thread={thread} toastId={id} />,
    { id: mailToastIdForThread(thread.id), duration: getStoredToastDurationMs() },
  );
}

function NewMailToast({
  thread,
  toastId,
}: {
  thread: UnreadInboxThread;
  toastId: string | number;
}) {
  const floatingThread = useFloatingThread();
  const { markThreadRead } = useMailContext();
  // The Settings "Try it" preview fires a fake thread (id "sample-…").
  // Its buttons just close the toast; there's no real thread to open or
  // mark read.
  const isSample = thread.id.startsWith("sample-");

  // Count this toast for the Dismiss All control (clears on unmount).
  useEffect(() => registerToast(), []);

  // Shared open path for View (read-only) and Reply. Reply passes
  // composerMode so the floating window opens straight into the reply
  // composer with the body focused (FloatingThreadWindow applies it, the
  // composer auto-focuses the editor for non-forward modes).
  async function openThread(composerMode?: "reply") {
    if (isSample) {
      toast.dismiss(toastId);
      return;
    }
    try {
      // Race the labels fetch against compose-init so we open the
      // popup as soon as both resolve — labels can be slower (Gmail
      // round-trip) but every floating window needs them for its
      // Move To menu.
      const [init, labels] = await Promise.all([
        fetchComposeInit(),
        fetchLabels().catch(() => [] as LabelRow[]),
      ]);
      floatingThread.open(
        thread.id,
        {
          labels: labels.length > 0 ? labels : null,
          templates: init.templates,
          currentUserEmail: init.user.email,
          currentUserFirstName: init.user.firstName,
          currentUserFullName: init.user.fullName,
        },
        // Notification opens preview the new message only — full thread
        // history would force the recruiter to scroll past months of
        // older messages to reach the message they were just notified
        // about. Pop-out from the inline thread keeps the full history.
        { previewLatestOnly: true, composerMode },
      );
      toast.dismiss(toastId);
    } catch (err) {
      toast.error("Couldn't open thread", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  // Mark read via the same /read route the mail system uses everywhere
  // else, optimistically clear the sidebar + topbar badge, then close.
  async function onMarkRead() {
    if (isSample) {
      toast.dismiss(toastId);
      return;
    }
    try {
      const res = await fetch(
        `/api/mail/threads/${encodeURIComponent(thread.id)}/read`,
        { method: "POST" },
      );
      if (res.ok) markThreadRead(thread.id);
    } catch {
      // Best-effort; the badge still clears on the next poll.
    }
    toast.dismiss(toastId);
  }

  // Theme read at render-time so the Settings picker takes effect on the
  // very next toast — no reload, no remount. Layout/sizing stays in the
  // dafdbfb Tailwind classes; only the palette is spec-driven (subtle /
  // tint are court-bound, ink carries its own fixed dark palette).
  const theme = getStoredToastTheme();
  const actionChipStyle = {
    border: `1px solid ${theme.actionBorder}`,
    background: theme.actionBg,
    color: theme.actionFg,
  };
  return (
    <div
      className="relative flex w-[314px] max-w-[94vw] items-center gap-2.5 rounded-xl px-3 py-2 shadow-[0_8px_22px_rgba(0,0,0,0.08)]"
      style={{ border: `1px solid ${theme.border}`, background: theme.bg, color: theme.fg }}
    >
      {/* Left icon: rounded square, matching the SMS toast, with the Mail
          glyph in place of the "text" label box. */}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm"
        style={{ background: theme.iconBg, color: theme.iconFg }}
      >
        <MailIcon className="h-4 w-4" />
      </div>

      {/* Center column: sender + subject preview, then a bottom-right
          action row (matches the notification mockup). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="truncate pr-5 text-[12px] font-semibold leading-tight tracking-[-0.02em]"
          style={{ color: theme.fg }}
        >
          {thread.fromName || thread.fromEmail || "(unknown sender)"}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-medium" style={{ color: theme.fgMuted }}>
          {truncate(thread.subject || "(no subject)", 80)}
        </div>

        {/* Action row: Reply opens the composer focused, View opens the
            thread read-only, Mark as Read clears it. Same chip look across
            all three, driven by the resolved theme. */}
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => openThread("reply")}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold shadow-sm transition"
            style={actionChipStyle}
          >
            <Reply className="h-2.5 w-2.5" />
            Reply
          </button>
          <button
            type="button"
            onClick={() => openThread()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold shadow-sm transition"
            style={actionChipStyle}
          >
            <Eye className="h-2.5 w-2.5" />
            View
          </button>
          <button
            type="button"
            onClick={onMarkRead}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold shadow-sm transition"
            style={actionChipStyle}
          >
            <CheckCheck className="h-2.5 w-2.5" />
            Mark as Read
          </button>
        </div>
      </div>

      {/* X close: absolute top-right, themed chip. */}
      <button
        type="button"
        onClick={() => toast.dismiss(toastId)}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-md shadow-sm transition"
        style={actionChipStyle}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
