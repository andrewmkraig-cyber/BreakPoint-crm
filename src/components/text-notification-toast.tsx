"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Phone, Reply, Eye, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getStoredTextToastTheme, toastBoxShadow } from "@/lib/toast-theme";
import { ActionChip, DismissBtn } from "@/components/_toast-chrome";
import { markThreadRead } from "@/app/phone/actions";

// In-app inbound text + inbound call toast. Shares the design
// language of the email toast (rounded card, soft shadow, themed
// chrome) but wires its own theme key (ace_text_toast_theme) and a
// mode discriminator so a text and a call render with the same
// component using slightly different content.
//
// On a text toast, Reply expands an inline composer right inside
// the toast — no jump to the candidate page. Send POSTs to /api/sms,
// flips SmsMessage.isRead → true for that thread, and broadcasts a
// `ace:phone-thread-read` window event so the sidebar Phone badge
// and any open /phone thread list both clear immediately. View
// still jumps to the candidate profile for full-thread review.

export type InboundTextEvent = {
  id: string;
  candidateId: string;
  candidateName: string;
  fromNumber: string;
  body: string;
  createdAtIso: string;
};

export type InboundCallEvent = {
  id: string;
  candidateId: string;
  candidateName: string;
  fromNumber: string;
  duration: number | null;
  status: string;
  createdAtIso: string;
};

// Window event broadcast from the toast's quick-reply handler. Both
// the sidebar Phone-badge poller (phone-context) and the /phone
// thread-list view subscribe to clear unread state without waiting
// for the next refetch.
export const PHONE_THREAD_READ_EVENT = "ace:phone-thread-read";

export type PhoneThreadReadEventDetail = { candidateId: string };

// Fired after a successful outbound SMS write to /api/sms. Anyone
// rendering a thread for the affected candidate (TextingExchanges on
// the candidate profile, the /phone detail pane) listens and re-fetches
// so the new outbound bubble appears immediately instead of waiting on
// the next 30 s poll. candidateId is null when the send was to a
// brand-new number not yet linked in Ace.
export const PHONE_SMS_SENT_EVENT = "ace:phone-sms-sent";

export type PhoneSmsSentEventDetail = { candidateId: string | null };

export function renderNewTextToast(event: InboundTextEvent) {
  toast.custom(
    (id) => <QuoToast mode="text" event={event} toastId={id} />,
    { duration: 8_000 },
  );
}

export function renderNewCallToast(event: InboundCallEvent) {
  toast.custom(
    (id) => <QuoToast mode="call" event={event} toastId={id} />,
    { duration: 8_000 },
  );
}

type QuoToastProps =
  | { mode: "text"; event: InboundTextEvent; toastId: string | number }
  | { mode: "call"; event: InboundCallEvent; toastId: string | number };

function QuoToast(props: QuoToastProps) {
  const router = useRouter();
  const candidateId = props.event.candidateId;
  const candidateName = props.event.candidateName || props.event.fromNumber;

  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const subtitle =
    props.mode === "text"
      ? truncate(props.event.body || "(no message)", 60).toUpperCase()
      : truncate(callSubtitle(props.event), 60);

  function onView() {
    if (candidateId) router.push(`/candidates/${candidateId}`);
    toast.dismiss(props.toastId);
  }

  function onStartReply() {
    if (!candidateId) return; // sample toasts have no candidateId — Reply is a no-op
    setReplying(true);
    setSendError(null);
  }

  async function onSendReply() {
    if (!candidateId || !body.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          toNumber: props.event.fromNumber,
          body: body.trim(),
        }),
      });
      if (!res.ok) {
        setSendError(`Send failed (${res.status})`);
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { status?: string; providerError?: string | null }
        | null;
      if (json?.status === "failed") {
        const detail = json?.providerError ? ` — ${json.providerError}` : "";
        setSendError(`Saved, but Quo reported failure${detail}`);
        return;
      }
      // Mark inbound rows in this thread as read so the sidebar
      // badge and per-thread badge clear. Best-effort — we still
      // dismiss even if this fails (the message was sent).
      try {
        await markThreadRead(candidateId);
      } catch {
        // Silent
      }
      window.dispatchEvent(
        new CustomEvent<PhoneThreadReadEventDetail>(PHONE_THREAD_READ_EVENT, {
          detail: { candidateId },
        }),
      );
      window.dispatchEvent(
        new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
          detail: { candidateId },
        }),
      );
      toast.dismiss(props.toastId);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  const theme = getStoredTextToastTheme();
  const Icon = props.mode === "text" ? MessageSquare : Phone;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: replying ? "flex-start" : "center",
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
        <Icon size={17} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: theme.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {candidateName}
          </span>
          <span style={{ fontSize: 11, color: theme.fgMuted, flexShrink: 0 }}>
            · {props.mode === "text" ? "Text" : "Call"}
          </span>
        </div>
        {replying ? (
          <div style={{ marginTop: 6 }}>
            <input
              autoFocus
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSendReply();
                } else if (e.key === "Escape") {
                  setReplying(false);
                }
              }}
              placeholder="Quick reply…"
              disabled={sending}
              style={{
                width: "100%",
                fontSize: 12.5,
                padding: "6px 8px",
                borderRadius: 6,
                border: `1px solid ${theme.actionBorder}`,
                background: theme.actionBg,
                color: theme.actionFg,
                outline: "none",
              }}
            />
            {sendError && (
              <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{sendError}</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: theme.fgMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
        {replying ? (
          <>
            <ActionChip
              theme={theme}
              onClick={onSendReply}
              label="Send"
              icon={sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              primary
            />
            <DismissBtn theme={theme} onClick={() => setReplying(false)} />
          </>
        ) : (
          <>
            {props.mode === "text" && candidateId && (
              <ActionChip
                theme={theme}
                onClick={onStartReply}
                label="Reply"
                icon={<Reply size={12} />}
                primary
              />
            )}
            <ActionChip theme={theme} onClick={onView} label="View" icon={<Eye size={12} />} />
            <DismissBtn theme={theme} onClick={() => toast.dismiss(props.toastId)} />
          </>
        )}
      </div>
    </div>
  );
}

function callSubtitle(call: InboundCallEvent): string {
  if (call.status === "missed" || call.status === "no-answer") return "MISSED CALL";
  if (call.duration && call.duration > 0) {
    return `CALL · ${formatDuration(call.duration)}`;
  }
  return "INCOMING CALL";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
