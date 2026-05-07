"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteConversationAction } from "./actions";

// Confirm-on-click delete for one Claude Panel conversation. The
// `conversationKey` is the conversationId or a "legacy-YYYY-MM-DD"
// synthetic for old NULL rows.
export function DeleteConversationButton({
  conversationKey,
}: {
  conversationKey: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteConversationAction({ conversationKey });
      if (!res.ok) {
        toast.error("Couldn't delete", {
          description: res.error ?? "Unknown error",
        });
        setConfirming(false);
        return;
      }
      toast.success("Conversation deleted.");
      router.refresh();
      router.push("/settings/history");
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
