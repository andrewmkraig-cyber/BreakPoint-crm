"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { dismissPlacementFromProfile } from "@/app/candidates/[id]/local-placement-actions";

// Faint X pinned to the far right of every job pill. First click swaps the
// X for a tight inline confirm strip ("Remove?" + check / cancel) so the
// destructive delete can't be muscle-memoried through. Confirm fires the
// org-scoped dismissPlacementFromProfile action and refreshes the row off
// the profile. Shared by the Ace-native (local-placement-rows) and
// RF-imported (placement-flows) row renderers so both pill surfaces get
// the same affordance in the split-view and the full profile.
export function DismissPlacementButton({
  placementId,
  jobTitle,
}: {
  placementId: string;
  jobTitle?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = await dismissPlacementFromProfile({ placementId });
      if (res.ok) {
        toast.success(jobTitle ? `Removed ${jobTitle}` : "Placement removed");
        router.refresh();
      } else {
        toast.error("Couldn't remove placement", { description: res.error });
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-court-fg-muted">
        <span className="whitespace-nowrap">Remove?</span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          aria-label="Confirm remove placement"
          title="Remove this placement"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-red-600 transition hover:bg-red-50 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          aria-label="Keep placement"
          title="Cancel"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-court-fg-muted transition hover:bg-court-surface-subtle disabled:opacity-60"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label="Remove placement from profile"
      title="Remove this placement from the candidate's profile"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-court-fg-muted/40 transition hover:bg-red-50 hover:text-red-600"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
