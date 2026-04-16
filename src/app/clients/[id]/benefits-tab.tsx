"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, X } from "lucide-react";
import { saveBenefits } from "@/app/clients/[id]/actions";
import { cn } from "@/lib/utils";

export type BenefitsState = {
  body: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

export function BenefitsTab({
  clientId,
  initial,
}: {
  clientId: number;
  initial: BenefitsState;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<boolean>(!initial.body);
  const [draft, setDraft] = useState<string>(initial.body);
  const [saved, setSaved] = useState<BenefitsState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await saveBenefits(clientId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ body: draft, updatedAt: result.value.updatedAt, updatedByName: saved.updatedByName });
      setEditing(false);
      router.refresh();
    });
  }

  function onCancel() {
    setDraft(saved.body);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="font-serif text-lg font-semibold text-navy">Benefits</h2>
          <p className="text-xs text-muted-foreground">
            Client benefits info — paste from email, benefits PDF, or notes. Line breaks are preserved.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-navy-400 shadow-sm transition hover:border-brand/40 hover:text-navy"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      <div className="p-5">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={18}
              placeholder="Paste benefits summary here…"
              className={cn(
                "w-full resize-vertical rounded-lg border border-border bg-white px-3 py-2 font-sans text-sm leading-relaxed text-navy",
                "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
              )}
              autoFocus
            />
            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-muted-foreground">
                {draft.length.toLocaleString()} characters
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-navy-400 shadow-sm transition hover:text-navy disabled:opacity-60"
                >
                  <X className="h-3 w-3" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : saved.body.trim() ? (
          <>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-navy">{saved.body}</div>
            {saved.updatedAt && (
              <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
                Last updated {new Date(saved.updatedAt).toLocaleString()}
                {saved.updatedByName ? ` by ${saved.updatedByName}` : ""}
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No benefits info yet. Click Edit to add a summary.
          </div>
        )}
      </div>
    </div>
  );
}
