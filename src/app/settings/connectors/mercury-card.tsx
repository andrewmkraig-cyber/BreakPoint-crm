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
    <div className="flex items-start justify-between gap-4 border-t border-court-border-soft py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-court-brand text-[11px] font-bold text-white"
          >
            M
          </span>
          <span className="text-[13px] font-medium text-court-fg">Mercury</span>
          {isConnected ? (
            <span className="inline-flex h-6 items-center rounded-full bg-court-accent-tint px-3 text-[10px] font-semibold uppercase tracking-wider text-court-brand-dark">
              Connected
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-court-fg-muted">
              Not connected
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-court-fg-muted">
          Auto-import expenses for ROI and Financial Performance tracking
        </div>
        {isConnected ? (
          <div className="mt-2 font-mono text-[11px] text-court-fg-muted">
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
              className="h-10 w-64 rounded-xl border border-court-border bg-court-surface px-3 text-[13px] text-court-fg placeholder:text-court-fg-muted/60 focus:border-court-accent focus:outline-none focus:ring-2 focus:ring-court-accent/10 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onSave}
              disabled={pending || draft.trim().length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-court-accent px-4 text-[12.5px] font-semibold text-white transition hover:bg-court-accent-dark disabled:opacity-60"
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
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-court-border bg-court-surface px-4 text-[12.5px] font-semibold text-court-fg transition hover:border-court-accent/40 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Disconnect
          </button>
        ) : null}
      </div>
    </div>
  );
}
