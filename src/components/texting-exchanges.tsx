"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
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

// Collapsible SMS thread for a single candidate. Mount fetches the full thread
// once and then polls every 30 s for new rows (inbound arrivals via the
// Krispcall webhook write into SmsMessage, which this fetch picks up). The
// layout is a standard SMS chat: outbound right (green), inbound left (gray).
// Polling only continues while the accordion is open — no point burning a
// network round-trip every 30 s for a section the recruiter isn't looking at.
export function TextingExchanges({ candidateId, defaultOpen }: { candidateId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [messages, setMessages] = useState<SmsRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchKey = useRef<string>("");

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sms?candidateId=${encodeURIComponent(candidateId)}`,
        { cache: "no-store" },
      );
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
  }, [candidateId]);

  useEffect(() => {
    if (!open) return;
    void fetchMessages();
    const interval = setInterval(() => {
      void fetchMessages();
    }, 30_000);
    return () => clearInterval(interval);
  }, [open, fetchMessages]);

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
            <ul className="space-y-3">
              {messages.map((m) => {
                const outbound = m.direction === "outbound";
                return (
                  <li
                    key={m.id}
                    className={cn("flex flex-col", outbound ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm",
                        outbound
                          ? "bg-emerald-600 text-white"
                          : "bg-court-surface-subtle text-court-fg",
                        m.status === "failed" && outbound && "bg-red-500",
                      )}
                    >
                      {m.body}
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
