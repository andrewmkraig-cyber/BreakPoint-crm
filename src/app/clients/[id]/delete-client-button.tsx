"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteClient } from "@/app/clients/[id]/actions";

export function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    startTransition(async () => {
      const res = await deleteClient(clientId);
      if (res.ok) {
        toast.success("Client deleted.");
        router.push("/clients");
        router.refresh();
      } else {
        toast.error(res.error);
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    // Quiet by default: ghost-style text button rendered static and
    // inline at the very bottom of the profile content - not fixed, not
    // floating. The caller only renders this on the Overview tab, so it
    // never strands itself on short tabs. Right-aligned and quiet until
    // hover, where it picks up the danger color so the destructive
    // intent is still legible.
    return (
      <div className="flex justify-end pt-8">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete client"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-court-fg-muted/70 transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <span className="font-medium">
          Delete {clientName}? This cannot be undone - every job, contact, agreement, benefit file, and pipeline entry tied to this client goes with it.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
