"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

export function AddClientNote({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function onAdd() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "client",
          entityId: clientId,
          note: trimmed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error("Couldn't save note", {
          description: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setText("");
      toast.success("Note added");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't save note", {
        description: e instanceof Error ? e.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-court-border bg-court-surface-subtle/40 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Add a note…"
        className="w-full resize-vertical rounded-md border border-transparent bg-court-surface px-3 py-2 text-sm text-court-fg placeholder:text-court-fg-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-court-fg-muted">{text.length} chars</span>
        <button
          type="button"
          onClick={onAdd}
          disabled={!text.trim() || busy}
          className="inline-flex items-center gap-1 rounded-md bg-court-brand px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-court-brand-dark disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add note
        </button>
      </div>
    </div>
  );
}
