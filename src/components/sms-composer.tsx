"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

// Single-line SMS composer that hangs off the candidate sidebar, right under
// the phone number. POSTs to /api/sms which upserts the outbound row and
// best-effort fires Krispcall; a failed Krispcall call still writes a row
// with status="failed" so the thread stays honest about what the recruiter
// actually tried to send.
export function SmsComposer({
  candidateId,
  toNumber,
}: {
  candidateId: string;
  toNumber: string | null;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [openingQuo, setOpeningQuo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !body.trim() || !toNumber || sending;
  const openInQuoDisabled = !toNumber || openingQuo;

  async function onOpenInQuo() {
    if (openInQuoDisabled || !toNumber) return;
    setOpeningQuo(true);
    try {
      const res = await fetch(
        `/api/quo/conversation?phoneNumber=${encodeURIComponent(toNumber)}`,
      );
      const json = (await res.json().catch(() => null)) as { url?: string } | null;
      if (json?.url) window.open(json.url, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningQuo(false);
    }
  }

  async function onSend() {
    if (disabled) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, toNumber, body: body.trim() }),
      });
      if (!res.ok) {
        setError(`Send failed (${res.status})`);
        return;
      }
      const msg = await res.json().catch(() => null);
      // Clear the input regardless — the row is saved either way. A Krispcall-
      // side failure surfaces as status="failed" on the persisted row, and we
      // show a lightweight inline note so the recruiter knows it didn't
      // actually leave the network.
      setBody("");
      if (msg?.status === "failed") {
        const detail = msg?.providerError ? ` — ${msg.providerError}` : "";
        setError(
          `Saved, but send failed${detail}. Check your Quo number and API key in Vercel.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-court-border bg-court-surface shadow-sm">
      <div className="border-b border-court-border px-4 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
          Text this candidate
        </h3>
      </div>
      <div className="space-y-2 p-4">
        {!toNumber && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            No phone on file — add one above to enable texting.
          </div>
        )}
        {/* Input on its own row, buttons on a second row right-aligned.
            Single-row layout pushed Send off-screen on narrow widths
            because input flex-1 + Send + Quo can't all fit in <300px
            of sidebar. Stacking guarantees Send stays visible at any
            viewport. */}
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder={toNumber ? "Type a text…" : "No phone on file"}
          disabled={!toNumber || sending}
          className="w-full rounded-lg border border-court-border bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-court-surface-subtle/60"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpenInQuo}
            disabled={openInQuoDisabled}
            className="inline-flex h-8 min-w-[48px] items-center justify-center whitespace-nowrap rounded-lg border border-court-border bg-court-surface px-3 text-xs font-semibold text-court-fg-muted shadow-sm transition hover:border-court-accent hover:text-court-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
            title="Open this conversation in Quo"
          >
            {openingQuo ? <Loader2 className="h-3 w-3 animate-spin" /> : "Quo"}
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={disabled}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-white shadow-sm transition",
              "bg-court-brand hover:bg-court-brand-dark disabled:cursor-not-allowed disabled:opacity-50",
            )}
            title="Send SMS"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
