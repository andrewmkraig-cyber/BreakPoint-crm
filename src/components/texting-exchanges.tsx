"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SmsRow = {
  id: string;
  candidateId: string;
  direction: string;
  body: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  krispcallId: string | null;
  createdAt: string;
};

// Collapsible SMS thread scoped either to one candidate or to one
// client. Mount fetches the full thread once and then polls every 30s
// for new rows (inbound arrivals via the Quo webhook write into
// SmsMessage, which this fetch picks up). The layout is a standard SMS
// chat: outbound right (green), inbound left (gray). Polling only
// continues while the accordion is open — no point burning a network
// round-trip every 30 s for a section the recruiter isn't looking at.
//
// Discriminated prop: pass exactly one of candidateId or clientId.
// candidateId wins when both are supplied (defensive — should not
// happen with TS narrowing). Mirrors the CallLogs prop shape.
export type TextingExchangesProps =
  | { candidateId: string; clientId?: undefined; defaultOpen?: boolean }
  | { clientId: string; candidateId?: undefined; defaultOpen?: boolean };

export function TextingExchanges(props: TextingExchangesProps) {
  const { candidateId, clientId, defaultOpen } = props;
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [messages, setMessages] = useState<SmsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const lastFetchKey = useRef<string>("");
  const listRef = useRef<HTMLUListElement | null>(null);

  // Single-bubble delete. Confirms first, then optimistically drops
  // the row so the bubble disappears immediately; on server failure
  // we restore the row and surface the error in the existing error
  // banner. Carrier-delivered messages aren't recalled — this is a
  // recruiter-side scrub of Ace's record only.
  const onDeleteMessage = useCallback(
    async (id: string) => {
      const target = messages.find((m) => m.id === id);
      if (!target) return;
      const preview = target.body.slice(0, 80) + (target.body.length > 80 ? "…" : "");
      if (!window.confirm(`Delete this message from Ace?\n\n"${preview}"\n\nThis won't unsend it from the recipient's phone.`)) {
        return;
      }
      setDeletingId(id);
      const snapshot = messages;
      setMessages((prev) => prev.filter((m) => m.id !== id));
      try {
        const res = await fetch(`/api/sms?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? `Delete failed (${res.status})`);
        }
        // Reset the dedupe key so the next poll doesn't no-op against
        // a stale snapshot that still contained the now-deleted row.
        lastFetchKey.current = "";
      } catch (e) {
        setMessages(snapshot);
        setError(e instanceof Error ? e.message : "Couldn't delete message.");
      } finally {
        setDeletingId(null);
      }
    },
    [messages],
  );

  const fetchMessages = useCallback(async () => {
    try {
      const queryParam = candidateId
        ? `candidateId=${encodeURIComponent(candidateId)}`
        : `clientId=${encodeURIComponent(clientId!)}`;
      const res = await fetch(`/api/sms?${queryParam}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`Couldn't load messages (${res.status})`);
        return;
      }
      const rows = (await res.json()) as SmsRow[];
      // Only re-render when the id/status set actually changed. Prevents the
      // 30 s poll from thrashing message bubbles when nothing new landed.
      const key = rows.map((r) => `${r.id}:${r.status}`).join("|");
      if (key === lastFetchKey.current) return;
      lastFetchKey.current = key;
      setMessages(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load messages.");
    } finally {
      setLoaded(true);
    }
  }, [candidateId, clientId]);

  useEffect(() => {
    if (!open) return;
    void fetchMessages();
    const interval = setInterval(() => {
      void fetchMessages();
    }, 30_000);
    return () => clearInterval(interval);
  }, [open, fetchMessages]);

  // Pin the scroll to the newest message every time the list mounts,
  // opens, or grows. Without this, the cap clips the latest bubble at
  // the bottom and the recruiter has to scroll down to see what they
  // just sent. The CSS `scroll-smooth` on the same element animates
  // the jump.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  return (
    <section className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-court-fg-muted" />
          <h2 className="font-serif text-base font-semibold text-court-fg">Texting Exchanges</h2>
          {loaded && messages.length > 0 && (
            <span className="rounded-full bg-court-surface-subtle px-2 py-0.5 text-[11px] font-semibold text-court-fg-muted">
              {messages.length}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-court-fg-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-court-border p-4">
          {!loaded ? (
            <div className="py-6 text-center text-sm text-court-fg-muted">Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="py-6 text-center text-sm text-court-fg-muted">No messages yet</div>
          ) : (
            <ul ref={listRef} className="max-h-64 space-y-3 overflow-y-auto scroll-smooth">
              {messages.map((m) => {
                const outbound = m.direction === "outbound";
                const isDeleting = deletingId === m.id;
                return (
                  <li
                    key={m.id}
                    className={cn("group flex flex-col", outbound ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "flex max-w-[75%] items-start gap-1.5",
                        outbound ? "flex-row" : "flex-row-reverse",
                      )}
                    >
                      {/* Delete affordance — shows on hover, sits to
                          the side of the bubble (left of outbound,
                          right of inbound) so it doesn't crowd the
                          message text. Confirms before deleting; only
                          touches Ace's record, not the carrier. */}
                      <button
                        type="button"
                        onClick={() => void onDeleteMessage(m.id)}
                        disabled={isDeleting}
                        aria-label="Delete this message from Ace"
                        title="Delete this message from Ace"
                        className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-court-fg-muted/0 transition hover:bg-court-surface-subtle hover:text-red-600 focus:text-court-fg-muted group-hover:text-court-fg-muted disabled:opacity-60"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                      <div
                        className={cn(
                          // font-sans pins the bubble to Inter even
                          // when the page-level inheritance chain
                          // hiccups (iOS Safari can drop the next/font
                          // CSS var on first paint, falling through to
                          // system-ui which reads as a different font).
                          "rounded-2xl px-3 py-2 font-sans text-sm whitespace-pre-wrap break-words shadow-sm",
                          outbound
                            ? "bg-emerald-600 text-white"
                            : "bg-court-surface-subtle text-court-fg",
                          m.status === "failed" && outbound && "bg-red-500",
                        )}
                      >
                        {m.body}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-court-fg-muted">
                      {formatTs(m.createdAt)}
                      {m.status === "failed" && outbound && (
                        <span className="ml-1 font-semibold text-red-700">· failed</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return time;
    const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${date} · ${time}`;
  } catch {
    return iso;
  }
}
