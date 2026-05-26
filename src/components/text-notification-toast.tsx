"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Phone, Reply, Eye, Send, Loader2, X, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markThreadRead } from "@/app/phone/actions";
import { getStoredToastDurationMs, registerToast } from "@/lib/toast-prefs";

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
  // null when the inbound number isn't matched to a Candidate/Client in
  // Ace. Reply + send still work (routed by fromNumber); mark-read uses
  // the unknown-number thread key.
  candidateId: string | null;
  candidateName: string;
  fromNumber: string;
  body: string;
  createdAtIso: string;
};

export type InboundCallEvent = {
  id: string;
  candidateId: string | null;
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

export type PhoneThreadReadEventDetail = { candidateId: string | null };

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

// Marks an inbound SMS thread read (best-effort) and broadcasts
// PHONE_THREAD_READ_EVENT so the sidebar Phone badge, the /phone thread
// list, and any open thread pane clear the unread state at once instead
// of waiting on their next poll. Uses the same markThreadRead server
// action the phone/Quo thread system uses everywhere else: a matched
// candidate marks by id, an unmatched number marks by its unknown-
// number thread key (unk:<10-digit tail>).
async function markThreadReadAndBroadcast(args: {
  candidateId: string | null;
  toNumber: string;
}): Promise<void> {
  const threadKey = args.candidateId
    ? args.candidateId
    : `unk:${args.toNumber.replace(/\D/g, "").slice(-10)}`;
  try {
    await markThreadRead(threadKey);
  } catch {
    // Best-effort — the badge still clears on the next poll.
  }
  window.dispatchEvent(
    new CustomEvent<PhoneThreadReadEventDetail>(PHONE_THREAD_READ_EVENT, {
      detail: { candidateId: args.candidateId },
    }),
  );
}

// Shared outbound-SMS reply path used by both the toast quick-reply
// and the View popup. POSTs to /api/sms, then on success marks the
// thread read (clearing unread badges) and broadcasts PHONE_SMS_SENT
// so any open thread re-fetches and shows the new outbound bubble.
// candidateId is null when the sender isn't matched in Ace — the send
// routes by toNumber and /api/sms saves the row with candidateId=null.
async function sendSmsReply(args: {
  candidateId: string | null;
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
      const detail = json?.providerError ? `: ${json.providerError}` : "";
      return { ok: false, error: `Saved, but Quo reported failure${detail}` };
    }
    await markThreadReadAndBroadcast({
      candidateId: args.candidateId,
      toNumber: args.toNumber,
    });
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
    { duration: getStoredToastDurationMs() },
  );
}

export function renderNewCallToast(event: InboundCallEvent) {
  toast.custom(
    (id) => <QuoToast mode="call" event={event} toastId={id} />,
    { duration: getStoredToastDurationMs() },
  );
}

type QuoToastProps =
  | { mode: "text"; event: InboundTextEvent; toastId: string | number }
  | { mode: "call"; event: InboundCallEvent; toastId: string | number };

function QuoToast(props: QuoToastProps) {
  const router = useRouter();
  const candidateId = props.event.candidateId;
  const candidateName = props.event.candidateName || props.event.fromNumber;
  // The Settings → Preferences theme preview fires a fake toast (id
  // prefixed "sample-", a placeholder fromNumber). Reply still renders
  // so the preview looks real, but Send must never hit /api/sms.
  const isSample = props.event.id.startsWith("sample-");

  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Count this toast for the Dismiss All control (clears on unmount).
  useEffect(() => registerToast(), []);

  const preview =
    props.mode === "text"
      ? truncate(props.event.body || "(no message)", 80)
      : callSubtitle(props.event);

  function onView() {
    // Text toast: View hands off to the centered popup (a global host
    // listens for this event) and closes the toast — for every inbound
    // text, matched candidate or not. No jump to the candidate / full
    // phone view. Call toasts keep the original profile jump.
    if (props.mode === "text") {
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
    // Reply is available for every inbound text — matched candidate or
    // not. No candidateId gate here.
    setReplying(true);
    setSendError(null);
  }

  async function onSendReply() {
    if (!body.trim() || sending) return;
    // Preview toast: simulate the send without touching the network.
    if (isSample) {
      toast.dismiss(props.toastId);
      return;
    }
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

  async function onMarkRead() {
    // Same markThreadRead path the View popup uses: clears the unread
    // badge for this thread (sidebar Phone badge + /phone list) and then
    // closes the toast. Preview toast just closes; never hits the net.
    if (isSample) {
      toast.dismiss(props.toastId);
      return;
    }
    await markThreadReadAndBroadcast({
      candidateId,
      toNumber: props.event.fromNumber,
    });
    toast.dismiss(props.toastId);
  }

  return (
    <div className="relative flex w-[314px] max-w-[94vw] items-center gap-2.5 rounded-xl border border-court-brand/70 bg-court-brand-tint px-3 py-2 shadow-[0_8px_22px_rgba(0,0,0,0.08)]">
      {/* Left icon: white rounded square. Text mode shows a MessageSquare
          glyph in green (matching the card's green border); call mode
          keeps the phone glyph inside the same square. */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-court-surface shadow-sm">
        {props.mode === "text" ? (
          <MessageSquare className="h-4 w-4 text-court-brand" />
        ) : (
          <Phone className="h-4 w-4 text-court-brand-dark" />
        )}
      </div>

      {/* Center column: sender (name, or the full number for unmatched
          senders, never truncated) with the preview below, or the inline
          quick-reply input once Reply is clicked, then a bottom-right
          action row (matches the notification mockup). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="pr-5 text-[12px] font-semibold leading-tight tracking-[-0.02em] text-court-fg">
          {candidateName}
        </div>
        {replying ? (
          <div className="mt-1">
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
              className="w-full rounded-md border border-court-border bg-court-surface px-2 py-1.5 text-[10px] text-court-fg outline-none placeholder:text-court-fg-muted/60 focus:border-court-brand"
            />
            {sendError && (
              <div className="mt-1 text-[9px] text-red-600">{sendError}</div>
            )}
          </div>
        ) : (
          <div className="mt-0.5 truncate text-[10px] font-medium text-court-fg-muted">
            {preview}
          </div>
        )}

        {/* Action row beneath the content, right-aligned. Default: Reply
            (text only) + View + Mark as Read (text only). Replying: Send +
            Cancel. Reply / View / Mark as Read / Cancel share the white
            card + gray border + ink text look; Send is the green primary. */}
        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          {replying ? (
            <>
              <button
                type="button"
                onClick={onSendReply}
                disabled={sending || !body.trim()}
                className="inline-flex items-center gap-1 rounded-lg border border-court-brand bg-court-brand px-2 py-1 text-[10px] font-semibold text-white shadow-sm transition hover:bg-court-brand-dark disabled:opacity-60"
              >
                {sending ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Send className="h-2.5 w-2.5" />
                )}
                Send
              </button>
              <button
                type="button"
                onClick={() => setReplying(false)}
                className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-[10px] font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {props.mode === "text" && (
                <button
                  type="button"
                  onClick={onStartReply}
                  className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-[10px] font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
                >
                  <Reply className="h-2.5 w-2.5" />
                  Reply
                </button>
              )}
              <button
                type="button"
                onClick={onView}
                className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-[10px] font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
              >
                <Eye className="h-2.5 w-2.5" />
                View
              </button>
              {props.mode === "text" && (
                <button
                  type="button"
                  onClick={onMarkRead}
                  className="inline-flex items-center gap-1 rounded-lg border border-court-border bg-court-surface px-2 py-1 text-[10px] font-semibold text-court-fg shadow-sm transition hover:bg-court-surface-subtle"
                >
                  <CheckCheck className="h-2.5 w-2.5" />
                  Mark as Read
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* X close: absolute top-right, white card + gray border. */}
      <button
        type="button"
        onClick={() => toast.dismiss(props.toastId)}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-md border border-court-border bg-court-surface text-court-fg-muted shadow-sm transition hover:text-court-fg"
      >
        <X className="h-2.5 w-2.5" />
      </button>
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
  // Falls back to the raw number when the sender isn't a matched
  // candidate/client in Ace.
  const senderName = event.candidateName || event.fromNumber;
  // Settings → Preferences theme-preview toast: render the popup for
  // fidelity but never hit /api/sms or markThreadRead.
  const isSample = event.id.startsWith("sample-");

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
    if (busy) return;
    // Preview toast — just close, no network.
    if (isSample) {
      onClose();
      return;
    }
    setMarking(true);
    await markThreadReadAndBroadcast({
      candidateId,
      toNumber: event.fromNumber,
    });
    setMarking(false);
    onClose();
  }

  async function onSend() {
    if (!body.trim() || sending) return;
    // Preview toast — simulate the send without touching the network.
    if (isSample) {
      onClose();
      return;
    }
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
            {event.candidateName && (
              // Only when a name is the title — otherwise the number is
              // already the title and we'd be showing it twice.
              <div className="mt-0.5 truncate text-[11px] text-court-fg-muted">
                {event.fromNumber}
              </div>
            )}
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
