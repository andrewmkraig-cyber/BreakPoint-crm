"use client";

import { Mail as MailIcon, Eye } from "lucide-react";
import { toast } from "sonner";
import { useFloatingThread } from "@/lib/floating-thread-context";
import { getStoredToastTheme, toastBoxShadow } from "@/lib/toast-theme";
import { ActionChip, DismissBtn } from "@/components/_toast-chrome";
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
  const floatingThread = useFloatingThread();

  async function onView() {
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
        { previewLatestOnly: true },
      );
      toast.dismiss(toastId);
    } catch (err) {
      toast.error("Couldn't open thread", {
        description: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  const theme = getStoredToastTheme();
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        minWidth: "360px",
        maxWidth: "420px",
        padding: "12px 14px",
        borderRadius: "14px",
        border: `1px solid ${theme.border}`,
        background: theme.bg,
        color: theme.fg,
        boxShadow: toastBoxShadow(),
        overflow: "hidden",
      }}
    >
      {theme.leftStrip && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: "3px",
            background: theme.accent,
          }}
        />
      )}
      <div
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          background: theme.iconBg,
          color: theme.iconFg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MailIcon size={17} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: theme.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.fromName || thread.fromEmail || "(unknown sender)"}
          </span>
          <span style={{ fontSize: 11, color: theme.fgMuted, flexShrink: 0 }}>· Email</span>
        </div>
        <div style={{ fontSize: 12.5, color: theme.fgMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
          {truncate(thread.subject || "(no subject)", 60)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
        <ActionChip theme={theme} onClick={onView} label="View" icon={<Eye size={12} />} />
        <DismissBtn theme={theme} onClick={() => toast.dismiss(toastId)} />
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
