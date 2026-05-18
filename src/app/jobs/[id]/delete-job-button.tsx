"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteJob } from "@/app/jobs/[id]/job-overview-actions";

// Matches DeleteCandidateButton / DeleteClientButton: small ghost-
// style trash tucked at the very bottom of the job profile. First
// click swaps the trash for a confirm strip with the job title and
// client spelled out so the recruiter can't muscle-memory through
// the destructive action. Cancel restores the trash. Delete fires
// the server action and on success kicks the caller back to /jobs.
export function DeleteJobButton({
  jobId,
  jobTitle,
}: {
  jobId: string;
  jobTitle: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function onDelete() {
    startTransition(async () => {
      const res = await deleteJob({ jobId });
      if (res.ok) {
        toast.success("Job deleted.");
        router.push("/jobs");
        router.refresh();
      } else {
        toast.error(res.error ?? "Delete failed.");
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <div className="fixed bottom-3 right-3 z-30">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete job"
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
          Delete {jobTitle}? This cannot be undone.
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
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
