"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCandidate } from "@/app/candidates/[id]/actions";

// Ace 28.0: small inline-confirm delete button that lives at the very
// bottom of the candidate profile. Default state is a single trash
// button using the danger variant; first click swaps the button for a
// confirm strip with the candidate's name spelled out so the recruiter
// can't muscle-memory through the destructive action. Cancel restores
// the trash button — Delete fires the server action and, on success,
// kicks the caller back to /candidates with a toast. There is
// intentionally no modal layer: the inline strip keeps the action
// reversible-feeling without stealing focus from the rest of the page.
export function DeleteCandidateButton({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    startTransition(async () => {
      const res = await deleteCandidate(candidateId);
      if (res.ok) {
        toast.success("Candidate deleted.");
        router.push("/candidates");
        router.refresh();
      } else {
        toast.error(res.error);
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    // Pinned to the viewport's bottom-right corner so it never
    // competes with active workflows in the middle of the page —
    // matches DeleteClientButton. An inline footer button strands
    // itself on short tabs (Email, etc.); fixed positioning sidesteps
    // that. Only on hover does it pick up the danger color.
    return (
      <div className="fixed bottom-3 right-3 z-30">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete candidate"
          className="inline-flex items-center gap-1 rounded-md bg-court-surface/80 px-2 py-1 text-[11px] font-medium text-court-fg-muted/70 backdrop-blur transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="pt-24">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <span className="font-medium">
          Delete {candidateName}? This cannot be undone.
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
