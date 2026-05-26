"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { INPUT_FRAME_CLASS, INPUT_CONTROL_CLASS } from "@/components/ui/input";
import { updateCandidate } from "@/app/candidates/[id]/actions";
import { normalizeToE164 } from "@/lib/rf-payload-shapes";
import {
  PHONE_SMS_SENT_EVENT,
  type PhoneSmsSentEventDetail,
} from "@/components/text-notification-toast";

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
        const detail = msg?.providerError ? `: ${msg.providerError}` : "";
        setError(
          `Saved, but send failed${detail}. Check your Quo number and API key in Vercel.`,
        );
      }
      // Broadcast even when the carrier hard-rejected — the row is in
      // Neon (status="failed") and TextingExchanges should still pick
      // it up so the recruiter sees the red bubble that didn't go out.
      window.dispatchEvent(
        new CustomEvent<PhoneSmsSentEventDetail>(PHONE_SMS_SENT_EVENT, {
          detail: { candidateId },
        }),
      );
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
          <AddPhoneInline candidateId={candidateId} />
        )}
        {/* Input on its own row, buttons on a second row right-aligned.
            Single-row layout pushed Send off-screen on narrow widths
            because input flex-1 + Send + Quo can't all fit in <300px
            of sidebar. Stacking guarantees Send stays visible at any
            viewport. */}
        <div className={`${INPUT_FRAME_CLASS} w-full`}>
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
            className={`${INPUT_CONTROL_CLASS} text-sm`}
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpenInQuo}
            disabled={openInQuoDisabled}
            // Yellow-outlined transparent pill. Shape + height match the
            // sibling Send button (Button size="sm" → px-3 py-1.5 text-xs
            // rounded-md) so the two affordances read as a sized pair.
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-yellow-400 bg-transparent px-3 py-1.5 text-xs font-semibold text-yellow-600 shadow-sm transition hover:bg-yellow-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-yellow-500 dark:text-yellow-400 dark:hover:bg-yellow-900/20"
            title="Open this conversation in Quo"
          >
            {openingQuo ? <Loader2 className="h-3 w-3 animate-spin" /> : "Quo"}
          </button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSend}
            disabled={disabled}
            title="Send SMS"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send
          </Button>
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

// Inline "Add Number" affordance shown inside the texting card when the
// candidate has no phone on file. Click "Add Number" → input + Save +
// Cancel; on save we reuse the existing updateCandidate server action
// (same one EditableIdentity uses) and refresh the route so the parent
// re-renders with toNumber populated, which unlocks the SMS composer
// without the recruiter leaving the page.
function AddPhoneInline({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, startSave] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function onSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error("Enter a phone number first.");
      return;
    }
    // E.164 normalize so the saved value matches the format Quo and
    // the texting / call paths expect. normalizeToE164 returns null
    // when the raw string can't be coerced — surface that as an
    // inline error instead of silently saving garbage.
    const normalized = normalizeToE164(trimmed);
    if (!normalized) {
      toast.error("Couldn't parse that number", {
        description: "Try a US-style number like 216-555-5555.",
      });
      return;
    }
    startSave(async () => {
      const res = await updateCandidate({
        id: candidateId,
        phone_number: normalized,
      });
      if (!res.ok) {
        toast.error("Save failed", { description: res.error });
        return;
      }
      toast.success("Phone number added");
      setEditing(false);
      setDraft("");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300">
        <span className="flex-1">No phone on file.</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-200"
        >
          <Plus className="h-3 w-3" /> Add Number
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-2">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="tel"
          value={draft}
          disabled={saving}
          placeholder="216-555-5555"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft("");
            }
          }}
          className="flex-1 rounded border border-amber-300 bg-court-surface px-2 py-1 text-xs text-court-fg placeholder:text-court-fg-muted/60 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-300 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setDraft("");
          }}
          disabled={saving}
          className="inline-flex items-center justify-center rounded border border-transparent p-1 text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
          aria-label="Cancel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
