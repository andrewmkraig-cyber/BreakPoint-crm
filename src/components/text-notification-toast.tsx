"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Phone, Reply, Eye, Send, Loader2, X, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { getStoredTextToastTheme, toastBoxShadow } from "@/lib/toast-theme";
import { ActionChip, DismissBtn } from "@/components/_toast-chrome";
import { Button } from "@/components/ui/button";
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

// Fired when the toast's View button is clicked. A global host
// (TextNotificationPopup, mounted in TextingProvider) listens and
// opens a centered popup for that message. The toast itself is
// dismissed by the click — View hands off to the popup rather than
// jumping the recruiter to the full candidate / phone view.
export const PHONE_VIEW_POPUP_EVENT = "ace:phone-view-popup";

export type PhoneViewPopupEventDetail = InboundTextEvent;

// Marks a candidate's inbound SMS thread read (best-effort) and
// broadcasts PHONE_THREAD_READ_EVENT so the sidebar Phone badge,
// the /phone thread list, and any open thread pane clear the unread
// state at once instead of waiting on their next poll. Uses the same
// markThreadRead server action the phone/Quo thread system uses
// everywhere else.
async function markThreadReadAndBroadcast(candidateId: string): Promise<void> {
  try {
    await markThreadRead(candidateId);
  } catch {
    // Best-effort — the badge still clears on the next poll.
  }
  window.dispatchEvent(
    new CustomEvent<PhoneThreadReadEventDetail>(PHONE_THREAD_READ_EVENT, {
      detail: { candidateId },
    }),
  );
}

// Shared outbound-SMS reply path used by both the toast quick-reply
// and the View popup. POSTs to /api/sms, then on success marks the
// thread read (clearing unread badges) and broadcasts PHONE_SMS_SENT
// so any open thread re-fetches and shows the new outbound bubble.
async function sendSmsReply(args: {
  candidateId: string;
  toNumber: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: args.candidateId,
        toNumber: args.toNumber,
        body: args.body,
      }),
    });
    if (!res.ok) return { ok: false, error: `Send failed (${res.status})` };
    const json = (await res.json().catch(() => null)) as
      | { status?: string; providerError?: string | null }
      | null;
    if (json?.status === "failed") {
      const detail = json?.providerError ? ` — ${json.providerError}` : "";
      return { ok: false, error: `Saved, but Quo reported failure${detail}` };
    }
    await markThreadReadAndBroadcast(args.candidateId);
    window.dispatchEvent(
      new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
        detail: { candidateId: args.candidateId },
      }),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}

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
    // Text toast: View hands off to the centered popup (a global host
    // listens for this event) and closes the toast — no jump to the
    // candidate / full phone view. Call toasts (and any text without a
    // matched candidate) keep the original profile jump.
    if (props.mode === "text" && candidateId) {
      window.dispatchEvent(
        new CustomEvent<PhoneViewPopupEventDetail>(PHONE_VIEW_POPUP_EVENT, {
          detail: props.event,
        }),
      );
      toast.dismiss(props.toastId);
      return;
    }
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
    const result = await sendSmsReply({
      candidateId,
      toNumber: props.event.fromNumber,
      body: body.trim(),
    });
    setSending(false);
    if (!result.ok) {
      setSendError(result.error);
      return;
    }
    toast.dismiss(props.toastId);
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

// Global host for the View popup. Mounted once (in TextingProvider) so
// it survives the toast being dismissed — the toast fires
// PHONE_VIEW_POPUP_EVENT on View, this listens and renders a centered
// popup for that single message. Only one popup at a time; a second
// View click replaces the first.
export function TextNotificationPopup() {
  const [event, setEvent] = useState<InboundTextEvent | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<PhoneViewPopupEventDetail>).detail;
      if (detail) setEvent(detail);
    }
    window.addEventListener(PHONE_VIEW_POPUP_EVENT, onOpen as EventListener);
    return () =>
      window.removeEventListener(PHONE_VIEW_POPUP_EVENT, onOpen as EventListener);
  }, []);

  if (!event) return null;
  // key remounts the card per message so its reply/send state resets
  // when a new View click swaps the event in.
  return (
    <TextPopupCard key={event.id} event={event} onClose={() => setEvent(null)} />
  );
}

// Centered message popup opened from the toast's View button. Shows the
// message body + sender, with X (close, thread stays unread), Mark as
// Read (clears unread badge, closes), and Reply (expands an inline
// input + Send inside the popup). Send routes through the same
// sendSmsReply path the toast quick-reply uses, which also marks the
// thread read on success.
function TextPopupCard({
  event,
  onClose,
}: {
  event: InboundTextEvent;
  onClose: () => void;
}) {
  const candidateId = event.candidateId;
  const senderName = event.candidateName || event.fromNumber;

  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = sending || marking;

  // Esc closes the popup (thread stays unread), matching the X button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function onMarkRead() {
    if (!candidateId || busy) return;
    setMarking(true);
    await markThreadReadAndBroadcast(candidateId);
    setMarking(false);
    onClose();
  }

  async function onSend() {
    if (!candidateId || !body.trim() || sending) return;
    setSending(true);
    setError(null);
    const result = await sendSmsReply({
      candidateId,
      toNumber: event.fromNumber,
      body: body.trim(),
    });
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Text message"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-court-border bg-court-surface p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-court-fg">
              <MessageSquare className="h-4 w-4 shrink-0 text-court-accent" />
              <span className="truncate font-serif text-base font-semibold">
                {senderName}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-court-fg-muted">
              {event.fromNumber}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-court-fg-muted transition hover:bg-court-surface-subtle hover:text-court-fg disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="whitespace-pre-wrap break-words rounded-lg border border-court-border bg-court-surface-subtle/40 p-3 text-sm text-court-fg">
          {event.body || "(no message)"}
        </div>

        {replying && (
          <div className="mt-3">
            <input
              autoFocus
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              placeholder="Type a reply…"
              disabled={sending}
              className="w-full rounded-md border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg outline-none focus:border-court-accent"
            />
          </div>
        )}

        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          {replying ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReplying(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onSend}
                disabled={sending || !body.trim()}
              >
                {sending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onMarkRead}
                disabled={busy}
              >
                {marking ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCheck className="h-3 w-3" />
                )}
                Mark as Read
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setError(null);
                  setReplying(true);
                }}
              >
                <Reply className="h-3 w-3" />
                Reply
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
