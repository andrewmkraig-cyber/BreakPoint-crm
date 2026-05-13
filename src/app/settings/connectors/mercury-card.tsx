"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveMercuryApiKey, disconnectMercury } from "./mercury-actions";

export function MercuryConnectorCard({
  maskedKey,
}: {
  maskedKey: string | null;
}) {
  const isConnected = maskedKey != null;
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function onSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error("Paste a Mercury API key first.");
      return;
    }
    startTransition(async () => {
      try {
        await saveMercuryApiKey(trimmed);
        setDraft("");
        toast.success("Mercury connected.");
      } catch (e) {
        toast.error("Couldn't save Mercury key", {
          description: e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }

  function onDisconnect() {
    startTransition(async () => {
      try {
        await disconnectMercury();
        toast.success("Mercury disconnected.");
      } catch (e) {
        toast.error("Couldn't disconnect Mercury", {
          description: e instanceof Error ? e.message : "Try again in a moment.",
        });
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-court-border bg-court-surface-subtle/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-court-brand text-[11px] font-bold text-white"
          >
            M
          </span>
          <span className="text-sm font-semibold text-court-fg">Mercury</span>
          {isConnected ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-court-brand-dark">
              Connected
            </span>
          ) : (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Not connected
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-court-fg-muted">
          Auto-import expenses for ROI and Financial Performance tracking
        </div>
        {isConnected ? (
          <div className="mt-2 font-mono text-xs text-court-fg-muted">
            {maskedKey}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Mercury API key"
              disabled={pending}
              className="w-64 rounded-md border border-court-border bg-court-surface px-2 py-1 text-xs text-court-fg placeholder:text-court-fg-dim focus:border-court-brand focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onSave}
              disabled={pending || draft.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-court-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-court-brand-dark disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save
            </button>
          </div>
        )}
      </div>
      <div className="shrink-0">
        {isConnected ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-court-border bg-court-surface-subtle px-3 py-1 text-xs font-semibold text-court-fg transition hover:bg-court-surface disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Disconnect
          </button>
        ) : null}
      </div>
    </div>
  );
}
