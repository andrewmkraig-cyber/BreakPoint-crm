"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleCandidateKept } from "@/app/candidates/[id]/keep-actions";

// Candidate-level Keep toggle. Reads the current state from the parent
// (whose isKept flag already merges the Candidate.tags column with the
// RF raw payload tags) and flips it via toggleCandidateKept. Uses the
// shared "keep" Button variant (light blue) so Keep reads as a soft-
// blue annotation alongside Schedule — the bookmark icon switches to a
// filled state when toggled on.

export function KeepCandidateButton({
  candidateId,
  isKept,
}: {
  candidateId: string;
  isKept: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const res = await toggleCandidateKept({ candidateId });
      if (!res.ok) {
        toast.error("Couldn't update Keep", { description: res.error });
        return;
      }
      toast.success(res.value.isKept ? "Kept" : "Removed from Kept");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="keep"
      onClick={onClick}
      disabled={isPending}
      aria-pressed={isKept}
      title={isKept ? "Remove from Kept" : "Mark as Kept"}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Bookmark className={isKept ? "h-3 w-3 fill-current" : "h-3 w-3"} />
      )}
      {isKept ? "Kept" : "Keep"}
    </Button>
  );
}
