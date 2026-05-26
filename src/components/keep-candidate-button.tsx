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
  className,
}: {
  candidateId: string;
  isKept: boolean;
  // Optional class merge so callers (candidate-profile action row) can
  // override the base "keep" variant's lighter blue-200 border with a
  // stronger blue-400 — sits at the same visual border weight as the
  // sibling Submit to Job button without affecting other Keep
  // surfaces (matches-tab, candidates list).
  className?: string;
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
      className={className ?? "text-sm"}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <Bookmark className={isKept ? "h-3 w-3 shrink-0 fill-current" : "h-3 w-3 shrink-0"} />
      )}
      {/* Label wrapped so a min-w-0 parent (e.g. a no-wrap sticky bar)
          can ellipsize "Keep"/"Kept" instead of forcing the button to
          push its siblings to a second row. No-op when the parent
          doesn't constrain width. */}
      <span className="truncate">{isKept ? "Kept" : "Keep"}</span>
    </Button>
  );
}
