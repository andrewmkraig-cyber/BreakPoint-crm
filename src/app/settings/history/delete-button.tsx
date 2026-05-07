"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteConversationAction } from "./actions";

// Confirm-on-click delete for one day's bucket of Claude Panel
// messages. No modal — a single inline confirm is enough for an
// internal admin surface, and matches how other Settings actions
// (template delete, trigger delete) handle destructive ops.
export function DeleteConversationButton({ date }: { date: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteConversationAction({ date });
      if (!res.ok) {
        toast.error("Couldn't delete", {
          description: res.error ?? "Unknown error",
        });
        setConfirming(false);
        return;
      }
      toast.success(`Deleted ${date} conversation.`);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-60 " +
        (confirming
          ? "bg-red-500 text-white hover:bg-red-600"
          : "border border-court-border bg-court-surface text-court-fg-muted hover:text-court-fg")
      }
      onBlur={() => setConfirming(false)}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Trash2 className="h-3 w-3" />
      )}
      {confirming ? "Click to confirm" : "Delete"}
    </button>
  );
}
